import { NextResponse } from "next/server";
import prisma from "@/utils/db";

const AGENTIC_SERVICE_URL = process.env.AGENTIC_SERVICE_URL;

async function forwardToAgenticService({
  file,
  documentId,
  userId,
  title,
  notes,
}) {
  if (!AGENTIC_SERVICE_URL) {
    throw new Error(
      "AGENTIC_SERVICE_URL environment variable is not configured."
    );
  }

  const arrayBuffer = await file.arrayBuffer();
  const blob = new Blob([arrayBuffer], {
    type: file.type || "application/octet-stream",
  });
  const upstreamForm = new FormData();
  upstreamForm.append("file", blob, file.name || "document");
  upstreamForm.append("documentId", documentId);
  upstreamForm.append("userId", userId);
  upstreamForm.append("title", title);
  if (notes) {
    upstreamForm.append("notes", notes);
  }

  const response = await fetch(`${AGENTIC_SERVICE_URL}/api/v1/vault/upload`, {
    method: "POST",
    body: upstreamForm,
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const errorMessage =
      payload?.detail || payload?.error || "Agentic ingestion failed.";
    throw new Error(errorMessage);
  }

  return payload;
}

export async function POST(request) {
  const userId = "guest";
  console.log(
    "[VAULT UPLOAD] clerkUserId:",
    clerkUserId,
    "devUserHeader:",
    devUserHeader
  );
  const userId = clerkUserId || devUserHeader;
  if (!userId) {
    console.log("[VAULT UPLOAD] Auth failed - no userId");
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "A file is required." }, { status: 400 });
  }

  const title =
    formData.get("title")?.toString().trim() ||
    file.name ||
    "Untitled Document";
  const notes = formData.get("notes")?.toString().trim() || null;

  const documentRecord = await prisma.knowledgeDocument.create({
    data: {
      userId,
      title,
      filename: file.name,
      mimeType: file.type || "application/octet-stream",
      size: file.size || 0,
      notes,
      status: "PROCESSING",
    },
  });

  try {
    const ingestionResult = await forwardToAgenticService({
      file,
      documentId: documentRecord.id,
      userId,
      title,
      notes,
    });

    // Build update data
    const updateData = {
      status: "PROCESSED",
      chunkCount: ingestionResult.chunkCount ?? 0,
      tokenEstimate: ingestionResult.tokenEstimate ?? 0,
    };
    
    // Add filePath if provided by backend
    if (ingestionResult.filePath) {
      updateData.filePath = ingestionResult.filePath;
    }
    
    const updated = await prisma.knowledgeDocument.update({
      where: { id: documentRecord.id },
      data: updateData,
    });

    return NextResponse.json(
      { document: updated, message: ingestionResult.message },
      { status: 201 }
    );
  } catch (error) {
    const detail = error?.message?.includes("fetch failed")
      ? `Agentic ingestion service is unreachable at ${AGENTIC_SERVICE_URL}.`
      : error?.message;
    await prisma.knowledgeDocument.update({
      where: { id: documentRecord.id },
      data: {
        status: "FAILED",
        error: detail,
      },
    });

    return NextResponse.json(
      { error: "Upload failed", detail },
      { status: 500 }
    );
  }
}
