# Redeploy vault service with updated code
$ErrorActionPreference = "Stop"

Write-Host "Building Lambda..." -ForegroundColor Cyan
$env:PINECONE_API_KEY = "pcsk_4rkikq_27ETYz7ZyxYj3gH7Rb2SKkw8418Z1LGUdCXgTeUHNhXowh3WUE557HahSCZ7dRe"

sam build
if ($LASTEXITCODE -ne 0) {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`nDeploying..." -ForegroundColor Cyan
sam deploy --config-file samconfig.toml
if ($LASTEXITCODE -ne 0) {
    Write-Host "Deploy failed!" -ForegroundColor Red
    exit 1
}

Write-Host "`nDeployment complete!" -ForegroundColor Green
Write-Host "`nTesting upload..." -ForegroundColor Cyan

# Test the upload endpoint
$response = Invoke-RestMethod `
    -Uri 'https://2avgmrr36j.execute-api.us-east-1.amazonaws.com/dev/vault/upload' `
    -Method POST `
    -ContentType 'application/json' `
    -InFile 'payload-upload.json' `
    -ErrorAction SilentlyContinue

if ($response) {
    Write-Host "`nUpload successful!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 10
} else {
    Write-Host "`nUpload failed - checking logs..." -ForegroundColor Yellow
    aws logs tail /aws/lambda/knowledge-vault-service-vault-dev --since 5m
}
