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
from pinecone import Pinecone, ServerlessSpec

# AWS clients
s3_client = boto3.client('s3')
dynamodb = boto3.resource('dynamodb')

# Environment variables
BUCKET_NAME = os.environ.get('VAULT_BUCKET_NAME')
TABLE_NAME = os.environ.get('VAULT_TABLE_NAME')
OPENAI_API_KEY = os.environ.get('OPENAI_API_KEY')
PINECONE_API_KEY = os.environ.get('PINECONE_API_KEY')
PINECONE_INDEX = os.environ.get('PINECONE_INDEX', 'vault-index')
PINECONE_CLOUD = os.environ.get('PINECONE_CLOUD', 'aws')
PINECONE_REGION = os.environ.get('PINECONE_REGION', 'us-east-1')

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

        # Pinecone index client with better error handling
        if not PINECONE_API_KEY:
            raise ValueError("PINECONE_API_KEY is required for vector storage")

        try:
            logger.info(f"Initializing Pinecone with index={PINECONE_INDEX}, cloud={PINECONE_CLOUD}, region={PINECONE_REGION}")
            pc = Pinecone(api_key=PINECONE_API_KEY)
            
            # List existing indexes
            existing_indexes = [idx['name'] for idx in pc.list_indexes()]
            logger.info(f"Existing Pinecone indexes: {existing_indexes}")
            
            if PINECONE_INDEX not in existing_indexes:
                logger.info(f"Creating new Pinecone index: {PINECONE_INDEX}")
                pc.create_index(
                    name=PINECONE_INDEX,
                    dimension=self.dimension,
                    metric='cosine',
                    spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION)
                )
                # Wait for index to be ready
                import time
                time.sleep(5)

            self.pinecone_index = pc.Index(PINECONE_INDEX)
            logger.info("Pinecone index initialized successfully")
        except Exception as e:
            logger.error(f"Failed to initialize Pinecone: {e}", exc_info=True)
            raise
    
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

        # Upsert vectors into Pinecone
        vectors = []
        for idx, embedding in enumerate(embeddings):
            vector_id = f"{document_id}#{idx}"
            metadata = {
                'document_id': document_id,
                'chunk_index': idx,
                'title': title,
                'user_id': user_id
            }
            vectors.append({
                'id': vector_id,
                'values': embedding,
                'metadata': metadata
            })

        if vectors:
            self.pinecone_index.upsert(vectors=vectors)
        
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

        # Query Pinecone for nearest neighbors
        pc_result = self.pinecone_index.query(
            vector=query_embedding,
            top_k=top_k,
            include_metadata=True
        )

        matches = pc_result.get('matches', []) if isinstance(pc_result, dict) else pc_result.matches

        if not matches:
            return {
                'answer': 'No documents found in your knowledge vault.',
                'sources': [],
                'raw_chunks': []
            }

        contexts: List[str] = []
        sources: List[Dict[str, Any]] = []
        raw_chunks: List[str] = []

        for match in matches:
            metadata = match.get('metadata', {}) if isinstance(match, dict) else match.metadata
            document_id = metadata.get('document_id')
            chunk_index = metadata.get('chunk_index')

            if document_id is None or chunk_index is None:
                continue

            chunk_id = f"{document_id}#{chunk_index}"
            item = self.table.get_item(Key={'chunk_id': chunk_id}).get('Item', {}) if self.table else {}
            if not item:
                continue

            title = item.get('title', metadata.get('title', 'Untitled'))
            text = item.get('text', '')

            contexts.append(f"Document: {title}\n{text}")
            sources.append({
                'document_id': document_id,
                'title': title,
                'chunk_index': chunk_index
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
