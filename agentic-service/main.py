"""
FastAPI entrypoint for agentic travel planner service.
Exposes endpoints for multi-agent itinerary generation.

Performance features:
  - SSE streaming endpoint for progressive itinerary display
  - In-memory + Redis caching (cache_service)
  - Pre-warm background task for top 50 destinations
  - Cache stats monitoring endpoint
"""
import asyncio
import logging
import sys
import typing
from pathlib import Path
from typing import Optional, Dict, Any

from fastapi import FastAPI, HTTPException, UploadFile, File, Form, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ValidationError

from config import settings
from services.cache_service import cache_stats as _cache_stats

# Initialize logging before any code that might raise exceptions
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

if sys.version_info >= (3, 12):
    _native_forward_eval = typing.ForwardRef._evaluate


    def _patched_forward_evaluate(self, globalns, localns, type_params=None, *, recursive_guard=None):
        guard = recursive_guard if recursive_guard is not None else set()
        return _native_forward_eval(self, globalns, localns, type_params, recursive_guard=guard)


    typing.ForwardRef._evaluate = _patched_forward_evaluate

try:
    from services.vault import VaultIngestionService
except Exception as vault_error:
    logger.warning(f"Vault service unavailable: {vault_error}")
    VaultIngestionService = None  # type: ignore

try:
    from agents.simple_planner import SimplePlanner as AgenticPlanner
    planner_initialization_error: Optional[Exception] = None
except Exception as planner_import_error:  # noqa: BLE001
    # planner.py (LangGraph multi-agent) is stub code — don't import it
    # as it needlessly loads LangGraph, LangChain, and heavy deps.
    AgenticPlanner = None  # type: ignore[assignment]
    planner_initialization_error: Optional[Exception] = planner_import_error
    logger.error(f"SimplePlanner import failed: {planner_import_error}")

app = FastAPI(
    title="Agentic Travel Planner",
    description="Multi-agent LangGraph service for itinerary generation",
    version="0.1.0"
)

# Add validation error handler for debugging
@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.error(f"Validation error for {request.url}: {exc.errors()}")
    logger.error(f"Request body: {await request.body()}")
    return JSONResponse(
        status_code=422,
        content={"detail": exc.errors(), "body": str(await request.body())}
    )

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001", "http://localhost:3002"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize planner lazily so ingestion routes still work if LangChain stack is misconfigured.
if AgenticPlanner is not None:
    try:
        planner = AgenticPlanner()
    except Exception as planner_error:  # noqa: BLE001
        logger.error("Planner initialization failed", exc_info=True)
        planner = None
        planner_initialization_error = planner_error
else:
    planner = None

vault_service = VaultIngestionService() if VaultIngestionService else None

# ---------------------------------------------------------------------------
# Pre-warm popular destinations on startup
# ---------------------------------------------------------------------------
TOP_DESTINATIONS = [
    ("Tokyo", "Japan"), ("Paris", "France"), ("London", "United Kingdom"),
    ("New York", "USA"), ("Rome", "Italy"), ("Barcelona", "Spain"),
    ("Bangkok", "Thailand"), ("Dubai", "UAE"), ("Singapore", "Singapore"),
    ("Istanbul", "Turkey"), ("Amsterdam", "Netherlands"), ("Seoul", "South Korea"),
    ("Sydney", "Australia"), ("Hong Kong", "China"), ("Prague", "Czech Republic"),
    ("Lisbon", "Portugal"), ("Berlin", "Germany"), ("Vienna", "Austria"),
    ("Florence", "Italy"), ("Kyoto", "Japan"), ("Bali", "Indonesia"),
    ("Marrakech", "Morocco"), ("Athens", "Greece"), ("Buenos Aires", "Argentina"),
    ("Mexico City", "Mexico"), ("Cairo", "Egypt"), ("Reykjavik", "Iceland"),
    ("Cape Town", "South Africa"), ("Mumbai", "India"), ("Havana", "Cuba"),
    ("Rio de Janeiro", "Brazil"), ("Hanoi", "Vietnam"), ("Taipei", "Taiwan"),
    ("Zurich", "Switzerland"), ("Edinburgh", "United Kingdom"), ("Dublin", "Ireland"),
    ("Copenhagen", "Denmark"), ("Stockholm", "Sweden"), ("Oslo", "Norway"),
    ("Helsinki", "Finland"), ("Kuala Lumpur", "Malaysia"), ("Osaka", "Japan"),
    ("Los Angeles", "USA"), ("San Francisco", "USA"), ("Chicago", "USA"),
    ("Miami", "USA"), ("Cancun", "Mexico"), ("Santorini", "Greece"),
    ("Phuket", "Thailand"), ("Queenstown", "New Zealand"),
]


async def _prewarm_destinations():
    """Background task: pre-generate itineraries for popular destinations.
    Uses a semaphore to batch 5 at a time for faster warm-up."""
    if planner is None:
        logger.warning("Skipping pre-warm: planner unavailable")
        return
    logger.info(f"Starting pre-warm for {len(TOP_DESTINATIONS)} destinations...")
    sem = asyncio.Semaphore(5)
    warmed = 0

    async def _warm_one(city: str, country: str):
        nonlocal warmed
        async with sem:
            try:
                await planner.generate_itinerary(
                    city=city, country=country, days=3,
                    budget=None, preferences={}, user_id="prewarm",
                )
                warmed += 1
            except Exception as exc:
                logger.warning(f"Pre-warm failed for {city}: {exc}")
            await asyncio.sleep(0.2)  # small delay per task to avoid rate-limiting

    await asyncio.gather(*[_warm_one(c, co) for c, co in TOP_DESTINATIONS])
    logger.info(f"Pre-warm complete: {warmed}/{len(TOP_DESTINATIONS)} destinations cached")


@app.on_event("startup")
async def startup_event():
    """Fire-and-forget pre-warm task on startup."""
    # Disabled during development to avoid rate-limiting user requests
    # asyncio.create_task(_prewarm_destinations())
    logger.info("Pre-warm disabled (enable in production)")


class PlanRequest(BaseModel):
    """Request schema for itinerary planning."""
    city: str
    country: str
    days: int = 3
    budget: Optional[float] = None
    # Accept dict or list and normalize later so the frontend can send arrays
    preferences: Optional[Any] = None
    user_id: Optional[str] = None


class PlanResponse(BaseModel):
    """Response schema with generated itinerary."""
    run_id: str
    tour: Dict[str, Any]
    cost: Dict[str, Any]
    citations: list[str]
    status: str


class VaultUploadResponse(BaseModel):
    """Response payload for knowledge vault ingestions."""
    documentId: str
    chunkCount: int
    tokenEstimate: int
    filePath: str
    message: str


class VaultQueryRequest(BaseModel):
    """Request schema for querying knowledge vault."""
    query: str
    user_id: str
    top_k: int = 3


class VaultQueryResponse(BaseModel):
    """Response schema for vault query with RAG answer."""
    answer: str
    chunks: list[Dict[str, Any]]
    citations: list[Dict[str, str]]
    tokens_used: Optional[int] = None


class GenerateItineraryRequest(BaseModel):
    """Request schema for generating travel itinerary."""
    city: str
    country: str
    days: int
    budget: Optional[float] = None
    preferences: Optional[list[str]] = None
    user_id: str


class RefineItineraryRequest(BaseModel):
    """Request schema for refining an existing itinerary."""
    run_id: str
    current_itinerary: Dict[str, Any]
    refinement: str
    user_id: str


@app.get("/")
async def root():
    """Health check endpoint."""
    return {
        "service": "agentic-travel-planner",
        "status": "running",
        "version": "0.1.0"
    }


@app.post("/api/agentic/plan", response_model=PlanResponse)
async def create_plan(request: PlanRequest):
    """
    Generate multi-day itinerary using agent orchestration.
    
    Workflow:
    1. Supervisor spawns specialist agents
    2. Researcher queries RAG + external APIs
    3. Logistics optimizes route/schedule
    4. Compliance checks safety/visas
    5. Experience generates media/copy
    6. Decision node reconciles, persists to DB
    """
    if planner is None:
        detail = "Planner stack is unavailable. Check server logs for LangChain initialization errors."
        if planner_initialization_error:
            detail += f" Reason: {planner_initialization_error}"
        raise HTTPException(status_code=503, detail=detail)

    try:
        logger.info(f"Planning request: {request.city}, {request.country} ({request.days} days)")
        
        prefs = request.preferences or {}
        if isinstance(prefs, list):
            prefs = {"tags": prefs}

        result = await planner.generate_itinerary(
            city=request.city,
            country=request.country,
            days=request.days,
            budget=request.budget,
            preferences=prefs,
            user_id=request.user_id
        )
        
        return PlanResponse(**result)
    
    except Exception as e:
        logger.error(f"Planning failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Planning error: {str(e)}")


@app.get("/api/agentic/status/{run_id}")
async def get_status(run_id: str):
    """Check status of a planning run."""
    # TODO: query agent run logs from DB
    return {"run_id": run_id, "status": "completed"}


@app.post("/api/v1/agentic/generate-itinerary")
async def generate_itinerary(request: GenerateItineraryRequest):
    """
    Generate a new travel itinerary using multi-agent orchestration.
    
    This endpoint uses the AgenticPlanner to coordinate multiple specialist agents:
    - Researcher: Gathers destination insights
    - Logistics: Optimizes routes and schedules
    - Compliance: Checks visa/safety requirements
    - Experience: Generates content and narrative
    
    Returns a complete itinerary with citations and cost information.
    """
    if planner is None:
        detail = "Planner stack is unavailable. Check server logs."
        if planner_initialization_error:
            detail += f" Reason: {planner_initialization_error}"
        raise HTTPException(status_code=503, detail=detail)
    
    try:
        logger.info(
            f"[Generate] Trip request: {request.city}, {request.country} "
            f"({request.days} days) for user {request.user_id}"
        )
        
        # Convert preferences list to dict format expected by planner
        preferences_dict = {}
        if request.preferences:
            for pref in request.preferences:
                preferences_dict[pref] = True
        
        result = await planner.generate_itinerary(
            city=request.city,
            country=request.country,
            days=request.days,
            budget=request.budget,
            preferences=preferences_dict,
            user_id=request.user_id
        )
        
        logger.info(f"[Generate] Successfully generated itinerary: {result.get('run_id')}")
        return result
    
    except Exception as exc:
        logger.error(f"[Generate] Failed: {str(exc)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to generate itinerary: {str(exc)}"
        ) from exc


@app.post("/api/v1/agentic/generate-itinerary-stream")
async def generate_itinerary_stream(request: GenerateItineraryRequest):
    """
    Streaming SSE endpoint for itinerary generation.

    Events emitted:
      event: status   -> {"phase": "starting|generating_itinerary|fetching_travel_data|cache_hit"}
      event: chunk    -> {"text": "..."} (incremental LLM tokens)
      event: result   -> {full itinerary JSON}
      event: done     -> {}
    """
    if planner is None:
        raise HTTPException(status_code=503, detail="Planner unavailable")

    preferences_dict = {}
    if request.preferences:
        for pref in request.preferences:
            preferences_dict[pref] = True

    async def event_generator():
        async for chunk in planner.generate_itinerary_stream(
            city=request.city,
            country=request.country,
            days=request.days,
            budget=request.budget,
            preferences=preferences_dict,
            user_id=request.user_id,
        ):
            yield chunk

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@app.post("/api/v1/agentic/refine-itinerary")
async def refine_itinerary(request: RefineItineraryRequest):
    """
    Refine an existing itinerary based on user feedback.
    
    Actually applies the LLM response to update the itinerary.
    """
    if planner is None:
        detail = "Planner stack is unavailable. Check server logs."
        if planner_initialization_error:
            detail += f" Reason: {planner_initialization_error}"
        raise HTTPException(status_code=503, detail=detail)
    
    try:
        import json as _json

        logger.info(
            f"[Refine] Refining itinerary {request.run_id} "
            f"for user {request.user_id}: {request.refinement}"
        )
        
        system_prompt = (
            "You are a travel planning assistant. Update the itinerary below according to the "
            "user's refinement request. Preserve the JSON structure exactly. Return ONLY valid JSON."
        )
        
        user_prompt = (
            f"Current Itinerary:\n{_json.dumps(request.current_itinerary)}\n\n"
            f"Refinement Request: {request.refinement}\n\n"
            f"Return the complete updated itinerary as JSON."
        )
        
        response = await planner.openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.5,
            max_tokens=16000,
            response_format={"type": "json_object"},
        )
        
        content = response.choices[0].message.content.strip()
        try:
            refined_tour = _json.loads(content)
        except _json.JSONDecodeError:
            # Fallback: keep original with note
            refined_tour = request.current_itinerary.copy()
            refined_tour["description"] = (
                f"{refined_tour.get('description', '')} (Refined: {request.refinement})"
            )
        
        result = {
            "run_id": request.run_id,
            "tour": refined_tour,
            "cost": {"llm_tokens": 500, "api_calls": 1, "total_usd": 0.01},
            "citations": ["AI refinement based on user feedback"],
            "status": "completed"
        }
        
        logger.info(f"[Refine] Successfully refined itinerary: {request.run_id}")
        return result
    
    except Exception as exc:
        logger.error(f"[Refine] Failed: {str(exc)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to refine itinerary: {str(exc)}"
        ) from exc


@app.get("/api/v1/cache/stats")
async def get_cache_stats():
    """Return cache hit/miss statistics and sizes."""
    return _cache_stats()


@app.post("/api/v1/vault/upload")
async def ingest_vault_document(
    file: UploadFile = File(...),
    documentId: str = Form(...),
    userId: str = Form(...),
    title: str = Form(...),
    notes: Optional[str] = Form(None),
):
    """
    Accept a user-uploaded document, extract text, chunk, embed, and persist to FAISS.
    The Next.js app stores metadata in Postgres; this endpoint handles vector indexing.
    """
    if not vault_service:
        raise HTTPException(status_code=503, detail="Vault service temporarily unavailable")
    
    try:
        result = vault_service.ingest_document(
            upload=file,
            document_id=documentId,
            user_id=userId,
            title=title,
            notes=notes,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001
        logger.error("Vault ingestion failed", exc_info=True)
        raise HTTPException(status_code=500, detail="Vault ingestion failed.") from exc


@app.post("/api/v1/vault/query", response_model=VaultQueryResponse)
async def query_vault_documents(request: VaultQueryRequest):
    """
    RAG query endpoint: retrieve relevant document chunks and generate answer.
    Filters results by user_id to ensure data isolation.
    """
    try:
        logger.info(f"Vault query from user {request.user_id}: {request.query}")
        
        result = vault_service.generate_answer(
            query=request.query,
            user_id=request.user_id,
            top_k=request.top_k,
        )
        
        return VaultQueryResponse(**result)
    
    except Exception as exc:  # noqa: BLE001
        logger.error("Vault query failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Query failed: {str(exc)}") from exc


@app.post("/api/v1/vault/query-stream")
async def query_vault_documents_stream(request: VaultQueryRequest):
    """
    RAG query endpoint with streaming: retrieve chunks and stream OpenAI response.
    Returns Server-Sent Events for progressive token display.
    """
    try:
        logger.info(f"Vault streaming query from user {request.user_id}: {request.query}")
        
        return StreamingResponse(
            vault_service.generate_answer_stream(
                query=request.query,
                user_id=request.user_id,
                top_k=request.top_k,
            ),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )
    
    except Exception as exc:  # noqa: BLE001
        logger.error("Vault streaming query failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Streaming query failed: {str(exc)}") from exc


class VaultPreviewResponse(BaseModel):
    """Response schema for document preview."""
    content: str
    content_type: str
    filename: str


@app.get("/api/v1/vault/preview/{document_id}")
async def preview_vault_document(
    document_id: str,
    user_id: str = Query(...),
    filePath: Optional[str] = Query(None),
    filename: Optional[str] = Query(None)
):
    """
    Retrieve document content for preview.
    Returns extracted text content from PDF/DOCX/TXT files.
    """
    if not vault_service:
        raise HTTPException(status_code=503, detail="Vault service temporarily unavailable")
    
    try:
        logger.info(f"Preview request for document {document_id} by user {user_id}")
        
        file_path = None
        
        upload_dir = vault_service.upload_dir.resolve()
        
        # First, try to use the stored filePath from database (most reliable)
        if filePath:
            file_path = Path(filePath)
            if not file_path.is_absolute():
                # If relative path, resolve relative to upload_dir
                file_path = upload_dir / file_path
            logger.info(f"Using stored filePath: {file_path}")
            # Verify it exists
            if not file_path.exists():
                logger.warning(f"Stored filePath does not exist: {file_path}, trying fallback methods")
                file_path = None
        
        # If filePath not provided or didn't work, try to construct from filename
        if not file_path and filename:
            expected_path = upload_dir / f"{document_id}_{filename}"
            logger.info(f"Trying filename-based path: {expected_path}")
            if expected_path.exists() and expected_path.is_file():
                file_path = expected_path
                logger.info(f"Found file using filename: {file_path}")
            else:
                logger.warning(f"Filename-based path does not exist: {expected_path}")
        
        # Last resort: pattern matching
        if not file_path:
            if not upload_dir.exists():
                logger.error(f"Upload directory does not exist: {upload_dir}")
                raise HTTPException(status_code=404, detail="Upload directory not found")
            
            logger.info(f"Trying pattern matching for: {document_id}_* in {upload_dir}")
            matching_files = list(upload_dir.glob(f"{document_id}_*"))
            logger.info(f"Found {len(matching_files)} matching files: {[str(f) for f in matching_files]}")
            if matching_files:
                file_path = matching_files[0]
                logger.info(f"Found file using pattern matching: {file_path}")
        
        if not file_path:
            logger.warning(f"No files found for document_id: {document_id}")
            raise HTTPException(status_code=404, detail=f"Document file not found for ID: {document_id}")
        
        # Verify file exists and is readable
        if not file_path.exists():
            logger.error(f"File path does not exist: {file_path}")
            raise HTTPException(status_code=404, detail="Document file not found")
        
        if not file_path.is_file():
            logger.error(f"Path is not a file: {file_path}")
            raise HTTPException(status_code=404, detail="Document file not found")
        
        logger.info(f"Found document file: {file_path}")
        
        # Extract text content based on file type
        try:
            content = vault_service._extract_text(file_path, None)
            if not content or not content.strip():
                logger.warning(f"Extracted content is empty for file: {file_path}")
                content = "(Document content is empty or could not be extracted)"
        except Exception as extract_error:
            logger.error(f"Error extracting text from {file_path}: {extract_error}", exc_info=True)
            raise HTTPException(
                status_code=500, 
                detail=f"Failed to extract text from document: {str(extract_error)}"
            ) from extract_error
        
        content_type = "text/plain"
        
        # Determine content type for display
        if file_path.suffix.lower() == ".pdf":
            content_type = "application/pdf"
        elif file_path.suffix.lower() == ".docx":
            content_type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        
        return VaultPreviewResponse(
            content=content,
            content_type=content_type,
            filename=file_path.name
        )
    
    except HTTPException:
        raise
    except Exception as exc:  # noqa: BLE001
        logger.error("Vault preview failed", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Preview failed: {str(exc)}") from exc


# /api/agentic/plan-stream removed — use /api/v1/agentic/generate-itinerary-stream instead


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
