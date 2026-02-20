"""
Lambda-optimized Knowledge Vault service.
Uses S3 for file storage and DynamoDB for metadata.
Uses OpenAI embeddings instead of local models to reduce package size.
"""
import json
import math
import os
import uuid
from pathlib import Path
from typing import Optional, List, Dict, Any
from io import BytesIO
from decimal import Decimal

import boto3
from pypdf import PdfReader
from docx import Document as DocxDocument
from openai import OpenAI

# AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment variables
BUCKET_NAME = os.environ.get('VAULT_BUCKET_NAME')
TABLE_NAME = os.environ.get('VAULT_TABLE_NAME')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')

# Initialize OpenAI
client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


class VaultService:
    """Handles document ingestion, embedding, and RAG queries for Lambda."""
    
    def __init__(self):
        import logging
        logger = logging.getLogger()
        logger.setLevel(logging.INFO)
        
        # Using OpenAI embeddings (text-embedding-3-small) - dimension 1536
        self.dimension = 1536
        
        # DynamoDB table
        if TABLE_NAME:
            self.table = dynamodb.Table(TABLE_NAME)
        else:
            self.table = None
            logger.warning("VAULT_TABLE_NAME not set")
        # No external vector store configured (Pinecone was removed)
        self.pinecone_index = None
    
    def ingest_document(
        self,
        file_content: bytes,
        filename: str,
        document_id: str,
        user_id: str,
        title: str,
        notes: Optional[str] = None
    ) -> Dict[str, Any]:
        """Ingest a document: extract text, chunk, embed, and store."""
        
        # Extract text from document
        text = self._extract_text(file_content, filename)
        
        if not text.strip():
            raise ValueError("No text content extracted from document")
        
        # Chunk text
        chunks = self._chunk_text(text)
        
        if not chunks:
            raise ValueError("Failed to create chunks from document")
        
        # Generate embeddings using OpenAI
        embeddings = self._generate_embeddings(chunks)
        
        # Store file in S3
        s3_key = f"documents/{user_id}/{document_id}/{filename}"
        s3_client.put_object(
            Bucket=BUCKET_NAME,
            Key=s3_key,
            Body=file_content,
            Metadata={
                'user_id': user_id,
                'document_id': document_id,
                'title': title
            }
        )
        
        # Store embeddings and metadata in DynamoDB
        for idx, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            chunk_id = f"{document_id}#{idx}"
            
            # Convert float embeddings to Decimal for DynamoDB
            decimal_embedding = [Decimal(str(float(x))) for x in embedding]
            
            self.table.put_item(Item={
                'chunk_id': chunk_id,
                'document_id': document_id,
                'user_id': user_id,
                'chunk_index': idx,
                'text': chunk,
                'embedding': decimal_embedding,
                'title': title,
                'notes': notes or '',
                's3_key': s3_key
            })

        # Vectors previously sent to Pinecone; now stored only in DynamoDB.
        # Embeddings are saved in DynamoDB above; no external vector upsert performed.
        
        token_estimate = math.ceil(len(text) / 4)
        
        return {
            'documentId': document_id,
            'chunkCount': len(chunks),
            'tokenEstimate': token_estimate,
            'filePath': s3_key,
            'message': 'Document ingested successfully'
        }
    
    def query(
        self,
        query: str,
        user_id: str,
        top_k: int = 3
    ) -> Dict[str, Any]:
        """Query the knowledge base and generate RAG response."""
        # Embed query using OpenAI
        query_embedding = self._generate_embeddings([query])[0]

        # Fall back to DynamoDB-based similarity search (no Pinecone)
        if not self.table:
            return {
                'answer': 'No documents found in your knowledge vault.',
                'sources': [],
                'raw_chunks': []
            }

        # Scan table and compute cosine similarity against stored embeddings
        results = []
        scan_kwargs = { 'ProjectionExpression': 'chunk_id, document_id, chunk_index, title, text, embedding' }
        done = False
        start_key = None
        while not done:
            if start_key:
                scan_kwargs['ExclusiveStartKey'] = start_key
            response = self.table.scan(**scan_kwargs)
            items = response.get('Items', [])
            for item in items:
                emb = item.get('embedding')
                if not emb:
                    continue
                # convert Decimal to float
                try:
                    vec = [float(x) for x in emb]
                except Exception:
                    continue
                score = self._cosine_similarity(query_embedding, vec)
                results.append((score, item))

            start_key = response.get('LastEvaluatedKey')
            done = start_key is None

        if not results:
            return {
                'answer': 'No documents found in your knowledge vault.',
                'sources': [],
                'raw_chunks': []
            }

        # take top_k matches by score
        results.sort(key=lambda x: x[0], reverse=True)
        top = results[:top_k]

        contexts: List[str] = []
        sources: List[Dict[str, Any]] = []
        raw_chunks: List[str] = []

        for score, item in top:
            document_id = item.get('document_id')
            chunk_index = item.get('chunk_index')
            title = item.get('title', 'Untitled')
            text = item.get('text', '')

            contexts.append(f"Document: {title}\n{text}")
            sources.append({
                'document_id': document_id,
                'title': title,
                'chunk_index': chunk_index,
                'score': score
            })
            raw_chunks.append(text)

        if not contexts:
            return {
                'answer': 'No documents found in your knowledge vault.',
                'sources': [],
                'raw_chunks': []
            }

        context = "\n\n".join(contexts)
        answer = self._generate_answer(query, context)

        return {
            'answer': answer,
            'sources': sources,
            'raw_chunks': raw_chunks
        }
    
    def query_stream(
        self,
        query: str,
        user_id: str,
        top_k: int = 3
    ) -> Dict[str, Any]:
        """Stream query response (Lambda returns full response)."""
        return self.query(query, user_id, top_k)
    
    def get_preview(
        self,
        document_id: str,
        user_id: str
    ) -> Dict[str, Any]:
        """Get preview of document chunks."""
        
        # First query to get all chunks for the document
        all_chunks = []
        last_evaluated_key = None
        
        while True:
            query_params = {
                'IndexName': 'document-index',
                'KeyConditionExpression': 'document_id = :did',
                'ExpressionAttributeValues': {':did': document_id}
            }
            
            if last_evaluated_key:
                query_params['ExclusiveStartKey'] = last_evaluated_key
            
            response = self.table.query(**query_params)
            all_chunks.extend(response.get('Items', []))
            
            last_evaluated_key = response.get('LastEvaluatedKey')
            if not last_evaluated_key:
                break
        
        if not all_chunks:
            raise ValueError("Document not found")
        
        # Verify ownership
        if all_chunks[0]['user_id'] != user_id:
            raise ValueError("Unauthorized access")
        
        # Sort chunks by chunk_index to maintain order
        all_chunks.sort(key=lambda x: x.get('chunk_index', 0))
        
        # Combine all chunk texts to show full document
        full_text = '\n\n'.join(chunk['text'] for chunk in all_chunks)
        
        return {
            'document_id': document_id,
            'title': all_chunks[0]['title'],
            'content': full_text,
            'chunk_count': len(all_chunks)
        }
    
    def _extract_text(self, file_content: bytes, filename: str) -> str:
        """Extract text from PDF or DOCX."""
        
        file_lower = filename.lower()
        
        if file_lower.endswith('.pdf'):
            reader = PdfReader(BytesIO(file_content))
            return "\n\n".join(page.extract_text() for page in reader.pages)
        
        elif file_lower.endswith('.docx'):
            doc = DocxDocument(BytesIO(file_content))
            return "\n\n".join(para.text for para in doc.paragraphs if para.text.strip())
        
        elif file_lower.endswith('.txt'):
            return file_content.decode('utf-8', errors='ignore')
        
        else:
            raise ValueError(f"Unsupported file type: {filename}")
    
    def _chunk_text(self, text: str, chunk_size: int = 800, overlap: int = 200) -> List[str]:
        """Simple text chunking with overlap."""
        
        chunks = []
        start = 0
        
        while start < len(text):
            end = start + chunk_size
            chunk = text[start:end]
            
            if chunk.strip():
                chunks.append(chunk)
            
            start = end - overlap
        
        return chunks
    
    def _generate_answer(self, query: str, context: str) -> str:
        """Generate answer using OpenAI."""
        
        if not client:
            return f"Based on your documents:\n\n{context[:500]}"
        
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                messages=[
                    {
                        "role": "system",
                        "content": "You are a helpful assistant that answers questions based on the provided context from the user's documents."
                    },
                    {
                        "role": "user",
                        "content": f"Context:\n{context}\n\nQuestion: {query}\n\nProvide a detailed answer based on the context."
                    }
                ],
                temperature=0.7,
                max_tokens=500
            )
            
            return response.choices[0].message.content
        
        except Exception as e:
            return f"Error generating answer: {str(e)}\n\nRelevant context:\n{context[:500]}"
    
    def _generate_embeddings(self, texts: List[str]) -> List[List[float]]:
        """Generate embeddings using OpenAI."""
        if not client:
            raise ValueError("OpenAI client not initialized")
        
        response = client.embeddings.create(
            model="text-embedding-3-small",
            input=texts
        )
        
        return [item.embedding for item in response.data]
    
    def _cosine_similarity(self, vec1: List[float], vec2: List[float]) -> float:
        """Calculate cosine similarity between two vectors."""
        dot_product = sum(a * b for a, b in zip(vec1, vec2))
        magnitude1 = math.sqrt(sum(a * a for a in vec1))
        magnitude2 = math.sqrt(sum(b * b for b in vec2))
        
        if magnitude1 == 0 or magnitude2 == 0:
            return 0.0
        
        return dot_product / (magnitude1 * magnitude2)
