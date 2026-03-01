# Agentic AI Travel Planner

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Production-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![OpenAI](https://img.shields.io/badge/LLM-OpenAI-412991?logo=openai)](https://platform.openai.com/docs)
[![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Pulumi](https://img.shields.io/badge/IaC-Pulumi-8A3391?logo=pulumi)](https://www.pulumi.com/)
[![AWS](https://img.shields.io/badge/Cloud-AWS-232F3E?logo=amazon-aws)](https://aws.amazon.com/)

A full-stack AI travel platform that generates structured, multi-day itineraries in real time. Built with **Next.js 14**, **FastAPI**, **OpenAI**, and deployed on **AWS** via **Pulumi** IaC.

---

## Overview

This application combines a streaming AI backend with a responsive React frontend to produce detailed travel plans — complete with day-by-day schedules, hotel recommendations, real place names, and cost estimates. The architecture is built around real-time interaction patterns rather than static request/response cycles, giving users live feedback as itineraries are generated.

---

## Features

- **Streaming itinerary generation** via Server-Sent Events (SSE) — output appears progressively as the model generates it
- **Multi-day travel plans** with daily schedules, real addresses, hotel suggestions, and budget breakdowns
- **Saved trips** — persist and revisit previously generated itineraries
- **Knowledge Vault** — upload documents to inject custom travel context into the model's reasoning
- **Google Maps integration** for visualizing itinerary locations day-by-day
- **Graceful fallback behavior** when upstream AI responses are incomplete or malformed

---

## System Architecture

```text
Browser (React / Next.js App Router)
  └─> Next.js API routes  (proxy + normalization)
        └─> FastAPI agentic service
              └─> OpenAI + Amadeus + Unsplash
                    └─> Prisma / PostgreSQL  (persistence)
```

### Streaming flow

1. Frontend posts to `/api/travel/planner/stream`
2. Next.js proxies the request to FastAPI `/api/v1/agentic/generate-itinerary-stream`
3. FastAPI emits SSE events across four phases: `status` → `chunk` → `result` → `done`
4. Frontend renders partial output progressively, then hydrates the final structured itinerary

### Reliability

- Malformed or truncated LLM output is normalized at the proxy layer so `daily_plans` always render.
- Chunk batching in the streaming path reduces event overhead and improves perceived responsiveness.
- Docker health checks gate `frontend` startup on a healthy `backend` container.

---

## Tech Stack

### Frontend

| Layer | Technology |
|---|---|
| Framework | Next.js 14 (App Router) |
| UI | React 18, Tailwind CSS, DaisyUI |
| Data fetching | TanStack Query |
| ORM client | Prisma Client |
| Maps | `@react-google-maps/api` |

### Backend

| Layer | Technology |
|---|---|
| API | FastAPI + Uvicorn |
| Runtime | Python 3.11, asyncio |
| AI | OpenAI SDK |
| Vector search | FAISS, sentence-transformers |
| Caching | cachetools (optional Redis) |
| External APIs | Amadeus (travel data), Unsplash (imagery) |

### Infrastructure

| Concern | Technology |
|---|---|
| Containerization | Docker + Docker Compose |
| App hosting | AWS EC2 |
| Edge / HTTPS | AWS CloudFront |
| Reverse proxy | Nginx |
| IaC | Pulumi (TypeScript) |

---

## Project Structure

```text
app/                    Next.js App Router pages and API routes
components/             React UI and planner components
agentic-service/        FastAPI service, planner agent, and API integrations
  agents/               Planner agent and tool definitions
  services/             Amadeus, Unsplash, caching, and vault integrations
  data/                 FAISS index and uploaded documents
infra/pulumi/           AWS infrastructure as code
prisma/                 Database schema and migrations
docker-compose.yml      Multi-service local and EC2 runtime
```

---

## Local Development

### 1. Install dependencies

```bash
# Frontend
npm install

# Backend
cd agentic-service
pip install -r requirements.txt
```

### 2. Configure environment

Create `.env.local` in the project root and `agentic-service/.env` for the backend.

Required variables:

```env
# AI / travel APIs
OPENAI_API_KEY=
AMADEUS_API_KEY=
AMADEUS_API_SECRET=
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

# Auth (Clerk)
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=

# Database
DATABASE_URL=
```

If targeting a local backend from the frontend:

```env
AGENTIC_SERVICE_URL=http://localhost:8001
```

### 3. Start services

**Frontend**
```bash
npm run dev
```

**Backend**
```bash
cd agentic-service
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

---

## Docker

Run the full stack locally with Docker Compose:

```bash
docker compose up -d --build
```

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| Backend | http://localhost:8000 |

---

## AWS Deployment (Pulumi)

Infrastructure lives in `infra/pulumi/` and provisions an EC2 instance, Elastic IP, security group, and CloudFront distribution. Environment variables are injected via Pulumi secrets at provision time.

```bash
cd infra/pulumi

pulumi config set --secret openaiApiKey        "..."
pulumi config set --secret amadeusApiKey       "..."
pulumi config set --secret amadeusApiSecret    "..."
pulumi config set --secret googleMapsApiKey    "..."
pulumi config set --secret clerkPublishableKey "..."
pulumi config set --secret clerkSecretKey      "..."

pulumi up
```

---

## Backend API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/` | Service health check |
| `POST` | `/api/v1/agentic/generate-itinerary` | Generate a full itinerary (blocking) |
| `POST` | `/api/v1/agentic/generate-itinerary-stream` | Generate with SSE streaming |
| `POST` | `/api/v1/agentic/refine-itinerary` | Refine an existing itinerary |
| `GET`  | `/api/v1/cache/stats` | Cache diagnostics |

---

## Recent Changes

- Switched the generation path to local FastAPI backend for richer structured output
- Restored end-to-end SSE streaming across frontend and Next.js proxy
- Fixed post-stream normalization so `daily_plans` always hydrate correctly
- Increased proxy stream timeout to accommodate longer model runs
- Added chunk batching in the planner streaming path to reduce event overhead
- Verified Dockerized EC2 deployment with backend startup command and health checks
