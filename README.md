# Agentic AI Travel Planner

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Production-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![OpenAI](https://img.shields.io/badge/LLM-OpenAI-412991?logo=openai)](https://platform.openai.com/docs)
[![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Pulumi](https://img.shields.io/badge/IaC-Pulumi-8A3391?logo=pulumi)](https://www.pulumi.com/)
[![AWS](https://img.shields.io/badge/Cloud-AWS-232F3E?logo=amazon-aws)](https://aws.amazon.com/)

Production-ready, full-stack AI travel platform built with **Next.js 14 + FastAPI + OpenAI + AWS + Pulumi**.

This project is designed to demonstrate senior-level engineering across product UX, AI orchestration, reliability, and cloud deployment.

## 1-minute recruiter skim

- **What it is**: an agentic AI travel platform that generates rich itineraries in real time via SSE streaming.
- **Why it matters**: demonstrates practical delivery of AI products beyond demos—latency handling, fallback behavior, and production deployment.
- **What I built**: Next.js frontend, FastAPI AI service, API integration layer (OpenAI + Amadeus + Unsplash), persistence, and AWS IaC.
- **Engineering depth**: streaming pipelines, async orchestration, structured response normalization, Dockerized services, CloudFront + EC2 deployment.
- **Hiring signal**: strong end-to-end ownership from product UX to backend performance tuning and cloud operations.

## Why this project is strong for employers

- **Streaming-first AI UX**: users see itinerary generation live via SSE instead of waiting on a spinner.
- **Performance engineering**: token chunk batching and parallelized backend work reduce perceived latency significantly.
- **Resilience patterns**: graceful fallback itinerary generation when upstream AI responses are incomplete.
- **Real API integration**: OpenAI + Amadeus + Unsplash in one pipeline with structured output handling.
- **Production deployment**: Dockerized services on EC2, HTTPS through CloudFront, infra managed by Pulumi.
- **Full-stack ownership**: frontend, backend, API contracts, persistence, infra, and operations in one repo.

---

## Core capabilities

- Generate multi-day travel itineraries with:
  - day-by-day schedules
  - real place names and addresses
  - hotel recommendations
  - cost breakdowns
- Real-time progress stream with event phases:
  - `status`
  - `chunk`
  - `result`
  - `done`
- Save and revisit generated plans
- Knowledge Vault support for document-powered travel context
- Google Maps integration for itinerary visualization

---

## System architecture

```text
Browser (React / Next.js App Router)
  -> Next.js API routes (proxy + normalization)
  -> FastAPI agentic service
  -> OpenAI + Amadeus + Unsplash
  -> Prisma/Postgres persistence
```

### Streaming path

1. Frontend posts to `/api/travel/planner/stream`
2. Next.js proxies to FastAPI `/api/v1/agentic/generate-itinerary-stream`
3. FastAPI streams SSE events continuously
4. Frontend renders partial output progressively, then final structured itinerary

### Reliability path

- If AI output is malformed or incomplete, the app normalizes and/or falls back to a usable itinerary.
- Docker health checks gate service dependencies (`frontend` depends on healthy `backend`).

---

## Tech stack

### Frontend

- Next.js 14 (App Router)
- React 18
- Tailwind CSS + DaisyUI
- TanStack Query
- Prisma Client
- Google Maps (`@react-google-maps/api`)

### Backend

- FastAPI + Uvicorn
- Python 3.11
- OpenAI SDK
- Async orchestration (`asyncio`)
- Caching (`cachetools`, optional Redis)
- Vector tooling (`FAISS`, sentence-transformers)
- Travel/media APIs: Amadeus, Unsplash

### Infra / DevOps

- Docker + Docker Compose
- AWS EC2 (app hosting)
- CloudFront (HTTPS edge termination)
- Nginx reverse proxy on EC2
- Pulumi (TypeScript IaC)

---

## Notable engineering updates

- Switched runtime generation path to local FastAPI backend for richer structured itinerary output.
- Restored end-to-end streaming UX in frontend + Next.js proxy.
- Fixed post-stream normalization so `daily_plans` always render correctly.
- Increased stream timeout handling in proxy to support longer LLM runs.
- Added chunk batching in planner streaming path to reduce event overhead and improve responsiveness.
- Added backend container startup command and verified deployment health in Dockerized EC2 runtime.

---

## Project structure

```text
app/                       Next.js App Router pages + API routes
components/                UI and planner components
agentic-service/           FastAPI service + planner logic + integrations
infra/pulumi/              AWS infrastructure as code
prisma/                    DB schema + migrations
docker-compose.yml         Local/EC2 multi-service runtime
```

---

## Local development

### 1) Install dependencies

```bash
npm install
cd agentic-service && pip install -r requirements.txt
```

### 2) Configure environment

Create:
- `.env.local` (frontend + app-level vars)
- `agentic-service/.env` (backend secrets)

Required keys include:
- `OPENAI_API_KEY`
- `AMADEUS_API_KEY`
- `AMADEUS_API_SECRET`
- `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`
- Clerk keys
- `DATABASE_URL`

### 3) Run services

Frontend:
```bash
npm run dev
```

Backend:
```bash
cd agentic-service
uvicorn main:app --host 0.0.0.0 --port 8001 --reload
```

If frontend is targeting local backend, set:
```env
AGENTIC_SERVICE_URL=http://localhost:8001
```

---

## Docker run

```bash
docker compose up -d --build
```

Services:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:8000`

---

## AWS deployment (Pulumi)

Infra lives in `infra/pulumi` and provisions:
- EC2 instance
- security group
- Elastic IP
- CloudFront distribution
- bootstrapping user-data for Docker runtime and env injection

Typical flow:

```bash
cd infra/pulumi
pulumi config set --secret openaiApiKey "..."
pulumi config set --secret amadeusApiKey "..."
pulumi config set --secret amadeusApiSecret "..."
pulumi config set --secret googleMapsApiKey "..."
pulumi config set --secret clerkPublishableKey "..."
pulumi config set --secret clerkSecretKey "..."
pulumi up
```

---

## API endpoints (backend)

- `GET /` service status
- `POST /api/v1/agentic/generate-itinerary`
- `POST /api/v1/agentic/generate-itinerary-stream`
- `POST /api/v1/agentic/refine-itinerary`
- `GET /api/v1/cache/stats`

---

## What this demonstrates technically

- Building AI products with **real-time interaction patterns** instead of static request/response UX
- Designing **fault-tolerant LLM systems** that degrade gracefully
- Operating a **polyglot production stack** (TypeScript + Python)
- Delivering **cloud infrastructure as code** with reproducible environments
- Executing **end-to-end debugging and performance tuning** across frontend, backend, and infra

---

## Portfolio-ready positioning

If you are a hiring manager, this repository reflects practical ability to:

- ship AI features that users can trust
- diagnose and resolve production issues quickly
- design for latency, reliability, and maintainability
- own product delivery from local prototype to deployed cloud system

This is not a toy LLM demo; it is an engineered, deployable AI application.
