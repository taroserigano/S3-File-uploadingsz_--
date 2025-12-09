"""Backfill existing DynamoDB embeddings into Pinecone.

Usage:
    PINECONE_API_KEY=... PINECONE_INDEX=vault-index PINECONE_CLOUD=aws PINECONE_REGION=us-east-1 \
    VAULT_TABLE_NAME=... python backfill_pinecone.py
"""
import os
from decimal import Decimal
from typing import List, Dict

import boto3
from pinecone import Pinecone, ServerlessSpec

# Env
TABLE_NAME = os.environ.get("VAULT_TABLE_NAME")
PINECONE_API_KEY = os.environ.get("PINECONE_API_KEY")
PINECONE_INDEX = os.environ.get("PINECONE_INDEX", "vault-index")
PINECONE_CLOUD = os.environ.get("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.environ.get("PINECONE_REGION", "us-east-1")
DIMENSION = 1536

if not TABLE_NAME:
    raise SystemExit("VAULT_TABLE_NAME is required")
if not PINECONE_API_KEY:
    raise SystemExit("PINECONE_API_KEY is required")

# Clients
pc = Pinecone(api_key=PINECONE_API_KEY)
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(TABLE_NAME)

# Ensure index exists
existing = [idx["name"] for idx in pc.list_indexes()]
if PINECONE_INDEX not in existing:
    pc.create_index(
        name=PINECONE_INDEX,
        dimension=DIMENSION,
        metric="cosine",
        spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
    )
index = pc.Index(PINECONE_INDEX, pool_threads=4)


def decimal_to_float_list(values: List[Decimal]) -> List[float]:
    return [float(v) for v in values]


def scan_chunks() -> List[Dict]:
    items: List[Dict] = []
    last_key = None
    while True:
        kwargs = {}
        if last_key:
            kwargs["ExclusiveStartKey"] = last_key
        resp = table.scan(**kwargs)
        items.extend(resp.get("Items", []))
        last_key = resp.get("LastEvaluatedKey")
        if not last_key:
            break
    return items


def batch_upsert(vectors: List[Dict]):
    if not vectors:
        return
    # pinecone v5 upsert accepts list of dicts with id/values/metadata
    index.upsert(vectors=vectors)


def main():
    items = scan_chunks()
    if not items:
        print("No items found in DynamoDB; nothing to backfill")
        return

    batch: List[Dict] = []
    for item in items:
        embedding = item.get("embedding")
        if not embedding:
            continue
        vector_id = item.get("chunk_id")
        if not vector_id:
            continue
        metadata = {
            "document_id": item.get("document_id"),
            "chunk_index": item.get("chunk_index"),
            "title": item.get("title"),
            "user_id": item.get("user_id"),
        }
        batch.append(
            {
                "id": vector_id,
                "values": decimal_to_float_list(embedding),
                "metadata": metadata,
            }
        )

        if len(batch) >= 100:  # upsert in chunks
            batch_upsert(batch)
            batch = []

    if batch:
        batch_upsert(batch)

    print("Backfill complete: upserted vectors to Pinecone")


if __name__ == "__main__":
    main()
