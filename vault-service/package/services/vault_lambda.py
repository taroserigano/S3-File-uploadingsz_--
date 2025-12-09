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
        # Using OpenAI embeddings (text-embedding-3-small) - dimension 1536
        self.dimension = 1536
        
        # DynamoDB table
        if TABLE_NAME:
            self.table = dynamodb.Table(TABLE_NAME)
        else:
            self.table = None
    
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
        
        # Retrieve all chunks for user (in production, use secondary index)
        response = self.table.scan(
            FilterExpression='user_id = :uid',
            ExpressionAttributeValues={':uid': user_id}
        )
        
        chunks = response.get('Items', [])
        
        if not chunks:
            return {
                'answer': 'No documents found in your knowledge vault.',
                'sources': [],
                'raw_chunks': []
            }
        
        # Calculate similarity scores (cosine similarity)
        scored_chunks = []
        for chunk in chunks:
            # Convert Decimal embeddings back to float for calculation
            chunk_embedding = [float(x) for x in chunk['embedding']]
            score = self._cosine_similarity(query_embedding, chunk_embedding)
            scored_chunks.append((score, chunk))
        
        # Sort by score and get top-k
        scored_chunks.sort(reverse=True, key=lambda x: x[0])
        top_chunks = [chunk for score, chunk in scored_chunks[:top_k]]
        
        # Build context
        context = "\n\n".join([
            f"Document: {chunk['title']}\n{chunk['text']}"
            for chunk in top_chunks
        ])
        
        # Generate answer using OpenAI
        answer = self._generate_answer(query, context)
        
        return {
            'answer': answer,
            'sources': [
                {
                    'document_id': chunk['document_id'],
                    'title': chunk['title'],
                    'chunk_index': chunk['chunk_index']
                }
                for chunk in top_chunks
            ],
            'raw_chunks': [chunk['text'] for chunk in top_chunks]
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
        
        response = self.table.query(
            KeyConditionExpression='document_id = :did',
            ExpressionAttributeValues={':did': document_id},
            Limit=5
        )
        
        chunks = response.get('Items', [])
        
        if not chunks:
            raise ValueError("Document not found")
        
        # Verify ownership
        if chunks[0]['user_id'] != user_id:
            raise ValueError("Unauthorized access")
        
        return {
            'document_id': document_id,
            'title': chunks[0]['title'],
            'preview': chunks[0]['text'][:500] + '...',
            'chunk_count': len(chunks)
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
