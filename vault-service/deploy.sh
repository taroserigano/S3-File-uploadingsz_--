#!/bin/bash
# Deploy Knowledge Vault Service to AWS Lambda using SAM

set -e

# Configuration
STACK_NAME="knowledge-vault-service"
ENVIRONMENT="dev"
REGION="us-east-1"

echo "🚀 Deploying Knowledge Vault Service to AWS Lambda..."

# Check if SAM CLI is installed
if ! command -v sam &> /dev/null; then
    echo "❌ AWS SAM CLI is not installed. Please install it first:"
    echo "   https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured. Run 'aws configure' first."
    exit 1
fi

# Prompt for OpenAI API key if not set
if [ -z "$OPENAI_API_KEY" ]; then
    read -sp "Enter your OpenAI API key: " OPENAI_API_KEY
    echo
fi

# Create services directory structure
mkdir -p services

# Build the Lambda package
echo "📦 Building Lambda package..."
sam build --use-container

# Deploy with CloudFormation
echo "☁️  Deploying to AWS..."
sam deploy \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        Environment="$ENVIRONMENT" \
        OpenAIApiKey="$OPENAI_API_KEY" \
    --no-confirm-changeset \
    --no-fail-on-empty-changeset

# Get the API endpoint
API_URL=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --region "$REGION" \
    --query "Stacks[0].Outputs[?OutputKey=='VaultApiUrl'].OutputValue" \
    --output text)

echo ""
echo "✅ Deployment complete!"
echo "📡 API Endpoint: $API_URL"
echo ""
echo "🔧 Next steps:"
echo "1. Update your Next.js .env file with:"
echo "   VAULT_API_URL=$API_URL"
echo ""
echo "2. Test the endpoint:"
echo "   curl $API_URL/vault/query -X POST -H 'Content-Type: application/json' -d '{\"query\":\"test\",\"user_id\":\"guest\"}'"
