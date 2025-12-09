"""
AWS Lambda handler for Knowledge Vault service.
Handles document ingestion, embedding, and RAG queries.
"""
import json
import logging
import base64
import io
from typing import Dict, Any, Optional
from pathlib import Path
from urllib.parse import parse_qs

logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Import vault service
try:
    from services.vault_lambda import VaultService
    vault_service = VaultService()
except Exception as e:
    logger.error(f"Failed to initialize vault service: {e}")
    vault_service = None


def parse_multipart_formdata(body: bytes, content_type: str) -> Dict[str, Any]:
    """Parse multipart/form-data from API Gateway."""
    import email
    from email import policy
    
    # Extract boundary from content-type
    boundary = None
    for part in content_type.split(';'):
        part = part.strip()
        if part.startswith('boundary='):
            boundary = part.split('=', 1)[1].strip('"')
            break
    
    if not boundary:
        raise ValueError("No boundary found in Content-Type")
    
    # Create email message from multipart data
    message_str = f"Content-Type: {content_type}\r\n\r\n"
    if isinstance(body, str):
        message_str += body
    else:
        message_str = message_str.encode() + body
    
    # Parse with email parser
    if isinstance(message_str, bytes):
        msg = email.message_from_bytes(message_str, policy=policy.default)
    else:
        msg = email.message_from_string(message_str, policy=policy.default)
    
    result = {}
    file_data = None
    filename = None
    
    for part in msg.walk():
        if part.get_content_maintype() == 'multipart':
            continue
        
        content_disposition = part.get('Content-Disposition', '')
        if 'name=' in content_disposition:
            # Extract field name
            name_match = content_disposition.split('name=')[1].split(';')[0].strip('"')
            
            # Check if it's a file
            if 'filename=' in content_disposition:
                filename = content_disposition.split('filename=')[1].split(';')[0].strip('"')
                file_data = part.get_payload(decode=True)
            else:
                # Regular form field
                value = part.get_payload(decode=True)
                if value:
                    result[name_match] = value.decode('utf-8') if isinstance(value, bytes) else value
    
    if file_data and filename:
        result['file'] = file_data
        result['filename'] = filename
    
    return result


def lambda_handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    AWS Lambda handler for vault operations.
    Routes to appropriate handler based on HTTP path and method.
    """
    try:
        logger.info(f"Event: {json.dumps(event)}")
        
        # Extract request details
        http_method = event.get("httpMethod", event.get("requestContext", {}).get("http", {}).get("method"))
        path = event.get("path", event.get("rawPath", ""))
        
        # Check if vault service is available
        if not vault_service:
            return {
                "statusCode": 503,
                "headers": cors_headers(),
                "body": json.dumps({"error": "Vault service unavailable"})
            }
        
        # Route to appropriate handler
        if http_method == "POST" and "/upload" in path:
            return handle_upload(event)
        elif http_method == "POST" and "/query" in path:
            return handle_query(event)
        elif http_method == "POST" and "/query-stream" in path:
            return handle_query_stream(event)
        elif http_method == "GET" and "/preview" in path:
            return handle_preview(event)
        elif http_method == "OPTIONS":
            return {
                "statusCode": 200,
                "headers": cors_headers(),
                "body": ""
            }
        else:
            return {
                "statusCode": 404,
                "headers": cors_headers(),
                "body": json.dumps({"error": "Not found"})
            }
            
    except Exception as e:
        logger.error(f"Lambda handler error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": str(e)})
        }


def handle_upload(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle document upload and ingestion."""
    try:
        # Get body
        body = event.get("body", "")
        is_base64 = event.get("isBase64Encoded", False)
        
        logger.info(f"Upload - Base64 encoded: {is_base64}")
        
        # Decode base64 if needed (API Gateway may encode the body)
        if is_base64 and isinstance(body, str):
            body = base64.b64decode(body).decode('utf-8')
        
        # Parse JSON body
        data = json.loads(body)
        logger.info(f"Parsed JSON keys: {list(data.keys())}")
        
        # Extract and decode file
        file_base64 = data.get("file")
        if not file_base64:
            raise ValueError("No file provided in request")
        
        file_content = base64.b64decode(file_base64)
        
        # Extract other fields
        filename = data.get("filename", "document.pdf")
        document_id = data.get("documentId", "")
        user_id = data.get("userId", "guest")
        title = data.get("title", filename)
        notes = data.get("notes")
        
        logger.info(f"Processing file: {filename}, size: {len(file_content)} bytes")
        
        # Ingest document
        result = vault_service.ingest_document(
            file_content=file_content,
            filename=filename,
            document_id=document_id,
            user_id=user_id,
            title=title,
            notes=notes
        )
        
        logger.info(f"Ingestion successful: {result}")
        
        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps(result)
        }
        
    except Exception as e:
        logger.error(f"Upload error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": str(e)})
        }


def handle_query(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle RAG query."""
    try:
        body = json.loads(event.get("body", "{}"))
        
        result = vault_service.query(
            query=body["query"],
            user_id=body["user_id"],
            top_k=body.get("top_k", 3)
        )
        
        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps(result)
        }
        
    except Exception as e:
        logger.error(f"Query error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": str(e)})
        }


def handle_query_stream(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle streaming RAG query."""
    # Note: Lambda doesn't support true HTTP streaming
    # This will return the full response at once
    try:
        body = json.loads(event.get("body", "{}"))
        
        result = vault_service.query_stream(
            query=body["query"],
            user_id=body["user_id"],
            top_k=body.get("top_k", 3)
        )
        
        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps(result)
        }
        
    except Exception as e:
        logger.error(f"Query stream error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": str(e)})
        }


def handle_preview(event: Dict[str, Any]) -> Dict[str, Any]:
    """Handle document preview."""
    try:
        # Extract document_id from path
        path = event.get("path", "")
        document_id = path.split("/")[-1]
        
        query_params = event.get("queryStringParameters", {}) or {}
        user_id = query_params.get("user_id")
        
        result = vault_service.get_preview(
            document_id=document_id,
            user_id=user_id
        )
        
        return {
            "statusCode": 200,
            "headers": cors_headers(),
            "body": json.dumps(result)
        }
        
    except Exception as e:
        logger.error(f"Preview error: {e}", exc_info=True)
        return {
            "statusCode": 500,
            "headers": cors_headers(),
            "body": json.dumps({"error": str(e)})
        }


def cors_headers() -> Dict[str, str]:
    """Return CORS headers for API responses."""
    return {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization"
    }
