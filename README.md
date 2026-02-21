# Agentic AI Travel Planner

> Full-stack AI travel itinerary generator with real-time Google Maps, streaming LLM responses, and a multi-agent Python backend.

![Travel Planner](https://github.com/taroserigano/Next.js-ChatGPT_App-Master/blob/main/img/tours1.jpg)

---

## Key Features

| Feature                     | Details                                                                           |
| --------------------------- | --------------------------------------------------------------------------------- |
| **AI Itinerary Generation** | 8 activities/day with real street addresses, geocoded to Google Maps pins         |
| **Streaming SSE**           | Watch the itinerary build in real-time via Server-Sent Events                     |
| **Interactive Maps**        | Numbered pins, polyline routes, distance-verified geocoding (50 km city boundary) |
| **Knowledge Vault**         | Upload PDFs/docs → RAG-powered Q&A over your own travel documents                 |
| **Save & Manage Trips**     | Persist plans to Postgres (Neon), browse saved trips                              |
| **Auth**                    | Clerk sign-in / sign-up with protected dashboard                                  |
| **Live Travel Data**        | Amadeus API for real flights & hotels, Unsplash hero images                       |

---

## Tech Stack

### Frontend

- **Next.js 14** (App Router) · **React 18** · **Tailwind CSS** · **DaisyUI**
- **@react-google-maps/api** for interactive maps with geocoding
- **TanStack React Query** for data fetching / caching
- **Clerk** for authentication
- **Prisma** ORM → PostgreSQL (Neon)

### Backend (`agentic-service/`)

- **Python 3.11+** · **FastAPI** · **Uvicorn** (ASGI)
- **OpenAI gpt-4o-mini** with JSON mode & streaming
- **LangChain / LangGraph** for multi-agent orchestration
- **Amadeus SDK** for real flight & hotel search
- **Unsplash API** for destination hero images
- **cachetools** / **Redis** for in-memory + distributed caching
- **orjson** for fast JSON serialization

---

## Quick Start (Local Development)

### Prerequisites

| Tool       | Version | Notes                                      |
| ---------- | ------- | ------------------------------------------ |
| Node.js    | 18+     | `node -v` to check                         |
| Python     | 3.11+   | 3.13 works too                             |
| PostgreSQL | Any     | Or use [Neon](https://neon.tech) free tier |
| Git        | Any     |                                            |

### 1. Clone & install

```bash
git clone https://github.com/taroserigano/Agentic_AI_RAG_LLM_Traveler_Site_App.git
cd Agentic_AI_RAG_LLM_Traveler_Site_App

# Frontend
npm install

# Backend
cd agentic-service
python -m venv .venv

# Windows
.venv\Scripts\activate

# macOS / Linux
# source .venv/bin/activate

pip install -r requirements.txt
cd ..
```

### 2. Configure environment variables

Create **`.env.local`** in the project root (Next.js reads this automatically):

```bash
# ── Authentication (Clerk) ──────────────────────────────────
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_...
CLERK_SECRET_KEY=sk_test_...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/chat
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/chat

# ── Database (Prisma → PostgreSQL) ──────────────────────────
DATABASE_URL=postgres://user:pass@host/db?sslmode=require

# ── Backend URL ─────────────────────────────────────────────
AGENTIC_SERVICE_URL=http://localhost:8000

# ── Google Maps (browser-side, needs NEXT_PUBLIC_ prefix) ───
NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=AIza...
```

Create **`agentic-service/.env`** for the Python backend:

```bash
# ── Required ────────────────────────────────────────────────
OPENAI_API_KEY=sk-proj-...

# ── Optional (enhance results when provided) ────────────────
AMADEUS_API_KEY=your_key
AMADEUS_API_SECRET=your_secret
GOOGLE_MAPS_API_KEY=AIza...
UNSPLASH_ACCESS_KEY=your_key
OPENWEATHER_API_KEY=your_key

# ── Optional (caching) ─────────────────────────────────────
# REDIS_URL=redis://localhost:6379/0
# CACHE_TTL_SECONDS=86400
```

### 3. Database setup

```bash
npx prisma migrate dev
npx prisma generate
```

### 4. Start both servers

**Terminal 1 — Backend (port 8000):**

```bash
cd agentic-service
.venv\Scripts\activate          # Windows
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

**Terminal 2 — Frontend (port 3000):**

```bash
npm run dev
```

Open **http://localhost:3000** → go to **Planner** → generate a trip.

---

## API Keys — Where to Get Them

| Key           | Free Tier?       | Sign Up                                                            |
| ------------- | ---------------- | ------------------------------------------------------------------ |
| OpenAI        | Pay-as-you-go    | https://platform.openai.com/api-keys                               |
| Clerk         | Free (10k MAU)   | https://clerk.com                                                  |
| Google Maps   | $200/mo credit   | https://console.cloud.google.com (enable Maps JS + Geocoding APIs) |
| Amadeus       | Free (test env)  | https://developers.amadeus.com                                     |
| Unsplash      | Free (50 req/hr) | https://unsplash.com/developers                                    |
| Neon Postgres | Free tier        | https://neon.tech                                                  |

---

## Project Structure

```
├── app/                          # Next.js App Router
│   ├── api/travel/               # API routes (planner, planner/stream, save, refine)
│   ├── api/vault/                # Knowledge Vault API (upload, query, documents)
│   ├── (dashboard)/              # Protected routes (planner, tours, chat, vault, profile)
│   └── sign-in/ sign-up/        # Clerk auth pages
│
├── components/
│   ├── TravelPlanner.jsx         # Main planner UI (form → streaming → itinerary display)
│   ├── DayMapView.jsx            # Google Maps per-day view with geocoding + distance guard
│   ├── KnowledgeVault.jsx        # RAG document upload & chat
│   ├── Chat.jsx                  # General AI chat
│   ├── ToursList.jsx             # Browse saved trips
│   └── Sidebar.jsx / NavLinks.jsx
│
├── agentic-service/              # Python FastAPI backend
│   ├── main.py                   # FastAPI app, SSE streaming, CORS, health endpoints
│   ├── config.py                 # Pydantic settings (env vars)
│   ├── agents/
│   │   ├── simple_planner.py     # Local dev planner (OpenAI streaming + caching)
│   │   ├── simple_planner_lambda.py  # Lambda-optimized planner
│   │   ├── planner.py            # Full LangGraph multi-agent planner
│   │   └── state.py / tools.py   # Agent state & tool definitions
│   └── services/
│       ├── amadeus_service.py    # Flight & hotel search (Amadeus SDK)
│       ├── unsplash_service.py   # Destination hero images
│       ├── cache_service.py      # TTLCache + optional Redis
│       └── vault.py              # FAISS vector store for RAG
│
├── prisma/
│   └── schema.prisma             # Tour, TripPlan, KnowledgeDocument, ChatSession models
│
├── utils/
│   ├── actions.js                # Server actions (Prisma queries)
│   └── db.ts                     # Prisma client singleton
│
├── serverless.yml                # AWS Lambda deployment (Serverless Framework)
├── render.yaml                   # Render.com deployment
├── docker-compose.yml            # Docker Compose for ECS / local Docker
├── Dockerfile                    # Frontend container
└── agentic-service/Dockerfile    # Backend container
```

---

## Deployment Options

### Option A: Serverless (current `serverless.yml`)

The existing setup deploys the Python backend to **AWS Lambda** via Serverless Framework, and the frontend to **Vercel** or **Render**.

```bash
# Deploy backend to Lambda
cd agentic-service
sls deploy

# Deploy frontend to Vercel
vercel --prod
```

**Pros:** Zero ops, pay-per-invocation, auto-scaling.
**Cons:** Cold starts (5–15s for Python + ML libs), 15-min timeout limit, 250 MB package limit (tight with torch/transformers), no persistent connections (WebSockets need API Gateway).

### Option B: ECS Fargate with Docker (recommended for production)

Better fit for this app because:

- **No cold starts** — containers stay warm
- **Streaming SSE works natively** — no API Gateway buffering issues
- **No package size limits** — include torch, transformers, FAISS freely
- **Predictable latency** — consistent ~2s first-byte vs 5–15s Lambda cold start
- **Long-running requests** — no 15-min timeout (itinerary generation can take 30–60s)
- **Cost-effective at moderate traffic** — Fargate Spot can be 70% cheaper than on-demand

Deploy **both containers** (frontend + backend) to ECS Fargate with an ALB in front.

```bash
# Build and push images
docker build -t travel-frontend .
docker build -t travel-backend ./agentic-service

# Tag and push to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin <account>.dkr.ecr.us-east-1.amazonaws.com
docker tag travel-frontend:latest <account>.dkr.ecr.us-east-1.amazonaws.com/travel-frontend:latest
docker tag travel-backend:latest <account>.dkr.ecr.us-east-1.amazonaws.com/travel-backend:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/travel-frontend:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/travel-backend:latest
```

### Option C: Local Docker (for testing containers)

```bash
docker-compose up --build
```

Frontend: http://localhost:3000 · Backend: http://localhost:8000

---

## Troubleshooting

| Problem                                        | Fix                                                                                                                                                |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `"This page can't load Google Maps correctly"` | Add `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` to `.env.local` and **restart** the frontend (`npm run dev`). `NEXT_PUBLIC_` vars are inlined at build time. |
| Backend returns **503**                        | Check `agentic-service/.env` has `OPENAI_API_KEY`. Run `pip install amadeus` if you see `ModuleNotFoundError: No module named 'amadeus'`.          |
| Only 4 pins on the map                         | You're hitting the fallback planner. The backend must be running and reachable at `AGENTIC_SERVICE_URL`.                                           |
| Pins in wrong city                             | The distance guard rejects geocoded locations >50 km from the city center. Check browser console for `[DayMapView] ⚠` warnings.                    |
| `bash: python: command not found` (Windows)    | Use the venv directly: `agentic-service\.venv\Scripts\python.exe -m uvicorn main:app --port 8000 --reload`                                         |
| `prisma migrate` fails                         | Ensure `DATABASE_URL` in `.env.local` is correct. For Neon, use the pooler URL with `?sslmode=require`.                                            |

---

## License

MIT
