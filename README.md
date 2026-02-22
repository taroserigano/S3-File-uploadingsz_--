# Agentic AI RAG LLM Traveler Site App

Production-style full-stack travel platform that combines:

- **Next.js 14 App Router UI**
- **FastAPI agentic backend**
- **SSE streaming itinerary generation**
- **RAG-backed knowledge vault ingestion/query**
- **Prisma + PostgreSQL persistence**

Built for realistic trip planning workflows: destination + preferences in, structured itinerary out, with live streaming, save/retrieve APIs, and document-grounded Q&A.

---

## Why this project is different

- **Agentic planning pipeline**: backend supports orchestrated itinerary generation and refinement flows instead of a single prompt/response call.
- **Streaming-first UX**: client receives incremental tokens/events over **Server-Sent Events** for faster perceived latency.
- **RAG in the same product surface**: users can upload docs to a vault and query those docs through retrieval-backed responses.
- **Deployment realism**: repository includes Dockerized services, EC2/Pulumi infra, Nginx reverse proxy, and health checks.
- **Prisma-based persistence model**: tours, chat sessions, vault docs, and trip plans are persisted with relational indexing.

---

## High-level architecture

```mermaid
flowchart LR
  U[Browser]
  N[Next.js 14 App Router\nFrontend + API Routes]
  F[FastAPI Agentic Service\nPython 3.11]
  O[OpenAI APIs]
  A[Amadeus / Unsplash]
  P[(PostgreSQL / Neon)]
  V[(FAISS + HF Embeddings)]

  U --> N
  N -->|SSE + JSON proxy| F
  N -->|Prisma| P
  F -->|LLM calls| O
  F -->|travel data| A
  F -->|metadata/status| P
  F -->|retrieve/ingest| V
```

### Runtime topology (Docker Compose)

- `frontend` (Next.js on `:3000`)
- `backend` (FastAPI on `:8000`)
- frontend depends on healthy backend
- backend healthcheck: Python probe against `http://localhost:8000/`

---

## Core capabilities

### 1) AI Trip Planner (standard + streaming)

- **Next API** proxies requests to backend planner endpoints.
- Supports preference normalization (object/list interop).
- Streaming endpoint forwards backend SSE directly to browser.
- Includes fallback itinerary generation logic in planner route when backend is degraded.

### 2) Knowledge Vault (RAG)

- Upload docs via API route and backend ingestion service.
- Store document metadata and processing status in Postgres.
- Query and query-stream routes for retrieval-backed answers.

### 3) Saved Trips / User State

- Prisma models persist trip plans, tours, tokens, chats, and document references.
- Dashboard surfaces planner and saved trips UX.

---

## Tech stack

### Frontend

- **Next.js 14.0.2** (App Router)
- **React 18**
- **Tailwind CSS + DaisyUI**
- **TanStack Query v5**
- **Prisma Client 5**
- **@react-google-maps/api**

### Backend (`agentic-service`)

- **Python 3.11**
- **FastAPI + Uvicorn**
- **LangChain 0.3.x / LangGraph 0.2.x**
- **OpenAI Python SDK (1.x)**
- **Transformers + SentenceTransformers + FAISS**
- **Redis/cachetools** (optional caching path)
- **Amadeus SDK**

### Infrastructure / Ops

- Docker multi-stage builds
- Docker Compose service orchestration
- Pulumi (TypeScript) for AWS EC2 provisioning
- Nginx reverse proxy (`:80 -> :3000`)

---

## Repository map

```text
app/                         Next.js routes (UI + API)
app/api/travel/              Planner/generate/refine/save APIs
app/api/vault/               Vault upload/query/document APIs
app/(dashboard)/             Dashboard routes
components/                  UI components (planner, sidebar, vault, chat...)
agentic-service/             FastAPI service + agents + tools + services
prisma/                      Prisma schema + migrations
utils/                       Prisma client + server actions
infra/pulumi/                AWS EC2 IaC (Pulumi)
Dockerfile                   Frontend image
agentic-service/Dockerfile   Backend image
docker-compose.yml           Local/prod compose stack
```

---

## API surface (key routes)

### Frontend-facing Next API routes

- `POST /api/travel/planner`
- `POST /api/travel/planner/stream`
- `POST /api/travel/planner/save`
- `GET /api/travel/planner/saved`
- `GET /api/travel/planner/saved/[id]`
- `POST /api/vault/upload`
- `GET /api/vault/documents`
- `DELETE /api/vault/documents/[id]`
- `GET /api/vault/documents/[id]/preview`
- `POST /api/vault/query`
- `POST /api/vault/query-stream`

### Backend FastAPI endpoints (selected)

- `GET /` health root
- `POST /api/agentic/plan`
- `GET /api/agentic/status/{run_id}`
- `POST /api/v1/agentic/generate-itinerary`
- `POST /api/v1/agentic/generate-itinerary-stream`

SSE stream emits lifecycle events (`status`, `chunk`, `result`, `done`) for progressive rendering.

---

## Data model snapshot (Prisma)

Main entities:

- `Tour`
- `TripPlan`
- `KnowledgeDocument`
- `ChatSession`
- `Token`

Backed by PostgreSQL with indexed access patterns on user-centric fields and creation timestamps.

---

## Environment configuration

Create two env files:

- root: `.env.local` (Next.js + Prisma + route proxy config)
- backend: `agentic-service/.env` (FastAPI + LLM/travel integrations)

### Root `.env.local` (minimum)

```bash
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
AGENTIC_SERVICE_URL=http://localhost:8000

NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=...

NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/chat
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/chat

# Used by specific Next API routes/features
OPENAI_API_KEY=...
UNSPLASH_API_KEY=...
VAULT_API_URL=http://localhost:8000
```

### `agentic-service/.env` (minimum)

```bash
OPENAI_API_KEY=...

# Optional integrations
DATABASE_URL=postgres://user:pass@host/db?sslmode=require
GOOGLE_MAPS_API_KEY=...
AMADEUS_API_KEY=...
AMADEUS_API_SECRET=...
UNSPLASH_ACCESS_KEY=...
OPENWEATHER_API_KEY=...

# Optional cache tuning
REDIS_URL=redis://localhost:6379/0
CACHE_TTL_SECONDS=86400
```

---

## Local development

### Prerequisites

- Node.js 18+
- Python 3.11+
- PostgreSQL (or Neon)
- npm + pip

### 1) Install frontend deps

```bash
npm install
```

### 2) Install backend deps

```bash
cd agentic-service
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS/Linux
# source .venv/bin/activate

pip install -r requirements.txt
cd ..
```

### 3) Prisma

```bash
npx prisma migrate dev
npx prisma generate
```

### 4) Run services

Terminal A:

```bash
cd agentic-service
.venv\Scripts\activate
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

Terminal B:

```bash
npm run dev
```

Open: `http://localhost:3000`

---

## Docker workflow

### Run full stack

```bash
docker compose up -d --build
```

### Check status

```bash
docker compose ps
docker compose logs -f backend
docker compose logs -f frontend
```

### Stop

```bash
docker compose down
```

---

## Build commands

From root `package.json`:

- `npm run dev`
- `npm run build` (`npx prisma generate && next build`)
- `npm run start`
- `npm run lint`

---

## AWS deployment (Pulumi + EC2)

Infrastructure definitions in `infra/pulumi` provision:

- EC2 `t3.micro`
- Security group (`80/443/22`)
- IAM role + SSM policy
- Elastic IP
- user-data bootstrap for Docker, repo clone, env file creation, compose startup, nginx setup

### Pulumi bootstrap

```bash
cd infra/pulumi
npm install
pulumi stack select dev
```

### Set required secrets

```bash
pulumi config set --secret openaiApiKey ...
pulumi config set --secret amadeusApiKey ...
pulumi config set --secret amadeusApiSecret ...
pulumi config set --secret googleMapsApiKey ...
pulumi config set --secret unsplashAccessKey ...
pulumi config set --secret databaseUrl ...
pulumi config set --secret clerkPublishableKey ...
pulumi config set --secret clerkSecretKey ...
pulumi config set keyPairName your-keypair-name
```

### Deploy

```bash
pulumi up
```

Pulumi exports include `appUrl`, `publicIp`, and `sshCommand`.

---

## Reliability notes

- Multiple routes are explicitly marked `dynamic = 'force-dynamic'` to avoid build-time Prisma evaluation failures.
- Frontend Docker build uses Debian (`node:18-slim`) plus OpenSSL for Prisma engine compatibility.
- Backend container runs as non-root and pre-configures writable cache/data directories for HF/transformers.
- Compose health dependency prevents frontend startup before backend readiness.

---

## Troubleshooting

### `Prisma Client could not locate Query Engine` during build

- Ensure frontend Docker image is Debian-based (`node:18-slim`) and has OpenSSL installed.

### Backend container unhealthy with permission errors

- Verify backend Dockerfile creates and owns `/app/data` and `/home/app/.cache` before switching users.

### App loads default Nginx page on EC2

- Disable/remove default server block so custom reverse proxy site config takes precedence.

### Streaming planner hangs

- Confirm Next route `/api/travel/planner/stream` points to backend `/api/v1/agentic/generate-itinerary-stream`.

---

## Future hardening ideas

- Add OpenTelemetry tracing across Next API routes and FastAPI planner calls.
- Introduce Redis as first-class cache layer in compose for deterministic warm cache behavior.
- Add CI workflows for `npm run lint`, type checks, and container build smoke tests.
- Add signed upload URLs and object storage for vault files.

---

## License

Add your preferred license (`MIT`, `Apache-2.0`, etc.) to clarify usage terms.
