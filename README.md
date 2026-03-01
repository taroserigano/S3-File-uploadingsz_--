# Agentic AI Travel Planner

[![Next.js](https://img.shields.io/badge/Next.js-14-black?logo=next.js)](https://nextjs.org/)
[![FastAPI](https://img.shields.io/badge/FastAPI-Production-009688?logo=fastapi)](https://fastapi.tiangolo.com/)
[![OpenAI](https://img.shields.io/badge/LLM-OpenAI-412991?logo=openai)](https://platform.openai.com/docs)
[![LangChain](https://img.shields.io/badge/LangChain-Agent_Framework-1C3C3C?logo=chainlink)](https://python.langchain.com/)
[![LangGraph](https://img.shields.io/badge/LangGraph-Multi--Agent_Orchestration-4B6BFB)](https://langchain-ai.github.io/langgraph/)
[![FAISS](https://img.shields.io/badge/RAG-FAISS_Vector_Store-orange)](https://faiss.ai/)
[![Docker](https://img.shields.io/badge/Containerized-Docker-2496ED?logo=docker&logoColor=white)](https://www.docker.com/)
[![Pulumi](https://img.shields.io/badge/IaC-Pulumi-8A3391?logo=pulumi)](https://www.pulumi.com/)
[![AWS](https://img.shields.io/badge/Cloud-AWS-232F3E?logo=amazon-aws)](https://aws.amazon.com/)

A production-deployed, multi-agent AI travel platform. A **LangGraph state machine** coordinates specialist agents — researcher, logistics planner, compliance checker, experience curator — each powered by **LangChain + OpenAI GPT**, augmented by **FAISS RAG**, and streaming results live to the user via SSE. Built on **Next.js 14 + FastAPI**, containerized with Docker, and deployed on **AWS EC2 + CloudFront** via **Pulumi IaC**.

<img width="3810" height="1831" alt="image" src="https://github.com/user-attachments/assets/b7ca206d-4cb7-413f-b41d-1fc86c9eb252" />
<img width="3769" height="1842" alt="image" src="https://github.com/user-attachments/assets/da24d9e5-e5e8-4ee3-919f-4ad9792d5158" />

<img width="3786" height="1861" alt="image" src="https://github.com/user-attachments/assets/da0fc521-cb5c-4b25-a4b1-084e3f4afb2f" />
<img width="3785" height="1858" alt="image" src="https://github.com/user-attachments/assets/27b9194e-976e-4f14-a52d-d8fff2d46090" />
<img width="3787" height="2148" alt="image" src="https://github.com/user-attachments/assets/6db7c6e4-abb2-49f1-8ab4-bf9979507cc0" />

<img width="3799" height="1883" alt="image" src="https://github.com/user-attachments/assets/00f09f95-37df-463f-a37b-24e146e1e044" />

---

## What Makes This Agentic

Most "AI travel apps" are a single prompt → single response. This is different.

A **LangGraph `StateGraph`** drives the entire generation pipeline as a directed multi-agent workflow. Each node is a specialist agent with its own responsibilities, tools, and LLM calls. State is typed and passed explicitly between nodes so each agent builds on the previous one's output — not a monolithic prompt.

```text
START
  └─> Supervisor          (orchestrates, routes, sets context)
        └─> Researcher    (FAISS RAG + knowledge retrieval)
              └─> Logistics  (Amadeus flights & hotels, scheduling)
                    └─> Compliance  (visa rules, safety, constraints)
                          └─> Experience  (dining, activities, local tips)
                                └─> Decision    (synthesizes final plan)
                                      └─> END
```

Each stage runs its own **LangChain `ChatOpenAI`** calls and has access to a typed **`PlannerState`** — a `TypedDict` carrying `research_results`, `logistics_plan`, `compliance_checks`, `experience_content`, `final_tour`, and more. A **`ToolExecutor`** dispatches LangChain `Tool` definitions (FAISS knowledge search, weather lookup, visa checker) to the agents that need them.

The final itinerary streams back to the browser via **SSE (Server-Sent Events)** in real time — users see content arrive as each agent node completes.

---

## Agentic AI Tech Stack

| Component | Technology |
|---|---|
| Agent orchestration | **LangGraph** `StateGraph` + conditional edges |
| Agent framework | **LangChain** `Tool`, `ToolExecutor`, `ChatOpenAI` |
| LLM | **OpenAI GPT-4o-mini** via `langchain_openai` |
| Agent state | Typed `PlannerState` (`TypedDict`) crossing graph nodes |
| RAG / knowledge | **FAISS** vector store + `sentence-transformers` embeddings |
| Streaming output | Async SSE generator (`AsyncGenerator`) over FastAPI |
| Async runtime | `asyncio.gather` for parallel agent + API calls |
| Structured output | `response_format=json_object` + `orjson` for guaranteed valid JSON |
| Caching | LRU in-memory + optional Redis via `cache_service` |
| Travel data | **Amadeus** API (flights, hotels) |
| Imagery | **Unsplash** API (hero images, destination photos) |

---

## Overview

The backend is a **FastAPI agentic service** that exposes a streaming endpoint. When a user submits a trip request, the `AgenticPlanner` initializes a `PlannerState` and runs it through the LangGraph graph. Each node — supervisor, researcher, logistics, compliance, experience, decision — enriches the state with LLM output, RAG results, and live API data. The final structured itinerary streams back to the Next.js frontend via SSE, which renders it progressively as chunks arrive.

Parallel execution (`asyncio.gather`) fires the LLM call, Amadeus hotel/flight lookups, and Unsplash image fetch concurrently. A FAISS index over uploaded user documents powers the Knowledge Vault — users can upload travel guides, past trip notes, or destination research and have the agents retrieve from them during planning.

---

## Features

- **Multi-agent itinerary generation** — six LangGraph nodes collaborating on a single plan
- **RAG-augmented planning** — FAISS vector search over user-uploaded documents feeds context into the researcher agent
- **Knowledge Vault** — upload PDFs, notes, or travel guides; agents retrieve relevant context at generation time
- **Live SSE streaming** — itinerary content appears progressively as each agent node completes
- **Multi-day travel plans** — day-by-day schedules, real addresses, hotel suggestions, cost breakdowns
- **Google Maps integration** — per-day route maps with numbered pin markers
- **Saved trips** — full itinerary persistence with map, hotels, cost estimates, dining, and day navigation
- **Parallel API calls** — Amadeus + Unsplash + LLM fired concurrently via `asyncio.gather`
- **Structured JSON output** — `response_format=json_object` guarantees parseable LLM responses
- **Graceful degradation** — malformed or partial LLM output is normalized; fallback itineraries prevent broken UI states

---

## System Architecture

```text
Browser (React / Next.js App Router)
  └─> Next.js API routes  (SSE proxy + response normalization)
        └─> FastAPI agentic service
              └─> LangGraph StateGraph
                    ├─> Supervisor agent
                    ├─> Researcher agent  ──> FAISS vector store (RAG)
                    ├─> Logistics agent   ──> Amadeus API (flights, hotels)
                    ├─> Compliance agent
                    ├─> Experience agent  ──> Unsplash API (imagery)
                    └─> Decision agent
                          └─> SSE stream ──> frontend
              └─> Prisma / PostgreSQL  (persistence)
```

### Streaming flow

1. Frontend posts to `/api/travel/planner/stream`
2. Next.js proxies the request to FastAPI `/api/v1/agentic/generate-itinerary-stream`
3. FastAPI runs the LangGraph workflow and emits SSE events: `status` → `chunk` → `result` → `done`
4. Frontend renders partial output progressively, then hydrates the final structured itinerary

### Reliability

- Malformed or truncated LLM output is normalized at the proxy layer so `daily_plans` always render.
- Chunk batching in the streaming path reduces event overhead and improves perceived responsiveness.
- Docker health checks gate `frontend` startup on a healthy `backend` container.

---

## Full Tech Stack

### AI / Agentic Layer

| Component | Technology |
|---|---|
| Orchestration | LangGraph `StateGraph` |
| Agent framework | LangChain `Tool`, `ToolExecutor`, `HumanMessage` |
| LLM wrapper | `langchain_openai.ChatOpenAI` (GPT-4o-mini) |
| RAG | FAISS + `sentence-transformers` |
| Structured output | OpenAI `response_format=json_object` |
| Serialization | `orjson` (fast JSON for streaming) |
| Async | Python `asyncio`, `asyncio.gather` |
| Caching | `cachetools` LRU + optional Redis |

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
| Runtime | Python 3.11 |
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
agentic-service/
  agents/
    planner.py          AgenticPlanner — LangGraph StateGraph definition
    state.py            PlannerState TypedDict (shared across all nodes)
    tools.py            LangChain Tool definitions (FAISS, weather, visa)
    simple_planner.py   Performance-optimized streaming planner
  services/
    amadeus_service.py  Flight and hotel data (Amadeus API)
    unsplash_service.py Destination imagery
    cache_service.py    LRU + Redis caching layer
    vault.py            Knowledge Vault document management
  data/
    faiss_index/        FAISS vector store (RAG)
    uploads/            User-uploaded knowledge documents
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
| `POST` | `/api/v1/agentic/generate-itinerary` | Run full LangGraph agent pipeline (blocking) |
| `POST` | `/api/v1/agentic/generate-itinerary-stream` | Stream LangGraph output via SSE |
| `POST` | `/api/v1/agentic/refine-itinerary` | Re-run agent pipeline to refine an existing plan |
| `GET`  | `/api/v1/cache/stats` | Cache diagnostics |

---

## Recent Changes

- Switched the generation path to local FastAPI backend for richer structured output
- Restored end-to-end SSE streaming across frontend and Next.js proxy
- Fixed post-stream normalization so `daily_plans` always hydrate correctly
- Added chunk batching in the planner streaming path to reduce event overhead
- Restored full itinerary view on saved trips — Google Maps, cost estimates, hotels, dining guide, day tabs, local tips

- Fixed post-stream normalization so `daily_plans` always hydrate correctly
- Increased proxy stream timeout to accommodate longer model runs
- Added chunk batching in the planner streaming path to reduce event overhead
- Verified Dockerized EC2 deployment with backend startup command and health checks
