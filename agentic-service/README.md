# Agentic Multi-Day Travel Planner Service

Python microservice exposing LangGraph-powered multi-agent itinerary planning via FastAPI.

## Stack

- **FastAPI** – REST endpoints for Next.js integration
- **LangGraph** – multi-agent orchestration (Destination Researcher, Budget & Logistics, Compliance, Experience Curator, Supervisor)
- **OpenAI GPT-4.1-mini / Ollama** – hybrid model strategy for speed + cost
- **Hugging Face Transformers + FAISS** – RAG retrieval over uploaded docs/guides
- **SQLAlchemy + PostgreSQL** – shared DB with Next.js Prisma schema

## Setup

1. **Install dependencies**

   ```bash
   cd agentic-service
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   pip install -r requirements.txt
   ```

2. **Configure environment**
   Create `.env` with:

```
DATABASE_URL=postgresql://user:pass@host:port/db
OPENAI_API_KEY=sk-...
OLLAMA_BASE_URL=http://localhost:11434  # or remote Ollama server
FAISS_INDEX_PATH=./data/faiss_index
HF_MODEL_NAME=sentence-transformers/all-MiniLM-L6-v2
```

3. **Run locally**
   ```bash
   uvicorn main:app --reload --port 8000
   ```
   Access at `http://localhost:8000/docs` for interactive API docs.

## Endpoints

- **POST /api/agentic/plan** – trigger multi-agent itinerary generation
  - Input: `{ "city": "Tokyo", "country": "Japan", "days": 5, "budget": 3000, "preferences": {...} }`
  - Output: `{ "run_id": "...", "tour": {...}, "cost": {...}, "citations": [...] }`
- **POST /api/v1/vault/upload** – chunk + embed an uploaded PDF/TXT into the user’s FAISS index
  - Multipart body: `file`, `documentId`, `userId`, `title`, optional `notes`
  - Output: `{ "documentId": "...", "chunkCount": 42, "tokenEstimate": 12000 }`

## Architecture

1. **Supervisor Node** – receives user request, spawns specialist agents
2. **Researcher Agent** – queries external APIs + FAISS for destination insights
3. **Logistics Agent** – schedules stops, optimizes routes via OR-Tools
4. **Experience Agent** – generates media, narrative copy, hotel recommendations
5. **Decision Node** – reconciles outputs, writes to Postgres, returns JSON

## Next.js Integration

In `utils/actions.js`:

```js
export const generateAgenticTour = async (destination) => {
  const res = await fetch("http://localhost:8000/api/agentic/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(destination),
  });
  return res.json();
};
```

## Docker (optional)

```dockerfile
FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Build & run:

```bash
docker build -t agentic-service .
docker run -p 8000:8000 --env-file .env agentic-service
```
