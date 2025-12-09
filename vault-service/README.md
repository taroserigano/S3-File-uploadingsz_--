# Knowledge Vault Service - AWS Lambda

Serverless RAG (Retrieval-Augmented Generation) system for document ingestion and Q&A.

## Architecture

- **AWS Lambda**: Serverless compute for document processing and queries
- **S3**: Document storage
- **DynamoDB**: Vector embeddings and metadata storage
- **API Gateway**: RESTful API endpoints
- **CloudFormation**: Infrastructure as Code

## Features

- 📄 Document upload (PDF, DOCX, TXT)
- 🔍 Semantic search with embeddings
- 💬 RAG-powered Q&A using OpenAI
- 🔒 User-scoped document isolation
- ⚡ Serverless architecture with auto-scaling

## Prerequisites

1. AWS CLI configured with credentials
2. AWS SAM CLI installed
3. OpenAI API key
4. Python 3.11

## Installation

### Install AWS SAM CLI

```bash
# macOS
brew install aws-sam-cli

# Windows
choco install aws-sam-cli

# Linux
pip install aws-sam-cli
```

### Install Dependencies

```bash
pip install -r requirements.txt
```

## Deployment

### Quick Deploy

```bash
chmod +x deploy.sh
./deploy.sh
```

### Manual Deploy

```bash
# Build
sam build --use-container

# Deploy
sam deploy \
    --stack-name knowledge-vault-service \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        Environment=dev \
        OpenAIApiKey=sk-your-key-here
```

## Configuration

After deployment, update your Next.js `.env` file:

```env
VAULT_API_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com/dev
```

## API Endpoints

### Upload Document
```
POST /vault/upload
Content-Type: application/json

{
  "file": "base64_encoded_content",
  "filename": "document.pdf",
  "documentId": "uuid",
  "userId": "guest",
  "title": "My Document",
  "notes": "Optional notes"
}
```

### Query Knowledge Base
```
POST /vault/query
Content-Type: application/json

{
  "query": "What is the main topic?",
  "user_id": "guest",
  "top_k": 3
}
```

### Stream Query (returns full response in Lambda)
```
POST /vault/query-stream
Content-Type: application/json

{
  "query": "Tell me about...",
  "user_id": "guest",
  "top_k": 3
}
```

### Preview Document
```
GET /vault/preview/{document_id}?user_id=guest
```

## Local Testing

```bash
# Start local API Gateway
sam local start-api

# Test upload endpoint
curl http://localhost:3000/vault/query \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"query":"test","user_id":"guest","top_k":3}'
```

## Monitoring

View logs in CloudWatch:
```bash
aws logs tail /aws/lambda/knowledge-vault-service-vault-dev --follow
```

## Cost Optimization

- Lambda: Pay per invocation (900s max timeout)
- DynamoDB: On-demand pricing (no provisioned capacity)
- S3: Standard storage with lifecycle rules (365 days)
- API Gateway: Pay per request

Estimated cost for low usage: ~$5-10/month

## Cleanup

```bash
# Delete the stack
aws cloudformation delete-stack --stack-name knowledge-vault-service

# Or using SAM
sam delete --stack-name knowledge-vault-service
```

## Differences from Original Service

1. **Storage**: S3 instead of local filesystem
2. **Database**: DynamoDB instead of FAISS index files
3. **Embeddings**: Stored in DynamoDB instead of FAISS
4. **Streaming**: Lambda returns full response (no true streaming)
5. **Scaling**: Automatic with Lambda (no server management)

## Troubleshooting

### Lambda timeout
- Increase `Timeout` in template.yaml (max 900s)
- Optimize document processing for large files

### Memory issues
- Increase `MemorySize` in template.yaml (max 10240 MB)
- Process documents in chunks

### Cold starts
- Consider using Lambda Provisioned Concurrency
- Optimize dependencies (reduce package size)

## Security

- API key authentication (to be implemented)
- VPC integration (optional)
- Encryption at rest (S3 and DynamoDB)
- IAM roles with least privilege

## Next Steps

1. Add API key authentication
2. Implement rate limiting
3. Add CloudFront for caching
4. Set up CI/CD pipeline
5. Add monitoring and alerting
