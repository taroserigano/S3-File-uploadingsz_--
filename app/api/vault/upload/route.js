import { NextResponse } from "next/server";
import prisma from "@/utils/db";

export const dynamic = "force-dynamic";

const VAULT_API_URL = process.env.VAULT_API_URL;

async function forwardToVaultService({
  file,
  documentId,
  userId,
  title,
  notes,
}) {
  if (!VAULT_API_URL) {
    throw new Error("VAULT_API_URL environment variable is not configured.");
  }

  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const base64File = buffer.toString("base64");

  // Send as JSON instead of multipart
  const response = await fetch(`${VAULT_API_URL}/vault/upload`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      file: base64File,
      filename: file.name || "document",
      documentId,
      userId,
      title,
      notes: notes || null,
    }),
  });

  console.log("[VAULT UPLOAD] Response status:", response.status);
  const responseText = await response.text();
  console.log("[VAULT UPLOAD] Response body:", responseText);

  let payload;
  try {
    payload = JSON.parse(responseText);
  } catch (e) {
    console.error("[VAULT UPLOAD] Failed to parse response:", responseText);
    throw new Error(
      `Invalid response from vault service: ${responseText.substring(0, 100)}`,
    );
  }

  if (!response.ok) {
    const errorMessage =
      payload?.detail || payload?.error || "Vault ingestion failed.";
    throw new Error(errorMessage);
  }

  return payload;
}

export async function POST(request) {
  const userId = "guest";
  console.log("[VAULT UPLOAD] Using guest user");

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
    const ingestionResult = await forwardToVaultService({
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
      { status: 201 },
    );
  } catch (error) {
    console.error("[VAULT UPLOAD] Error:", error);
    console.error("[VAULT UPLOAD] Error message:", error?.message);
    console.error("[VAULT UPLOAD] Error cause:", error?.cause);

    const detail = error?.message?.includes("fetch failed")
      ? `Vault ingestion service is unreachable at ${VAULT_API_URL}.`
      : error?.message || "Unknown error";

    await prisma.knowledgeDocument.update({
      where: { id: documentRecord.id },
      data: {
        status: "FAILED",
        error: detail,
      },
    });

    return NextResponse.json(
      { error: "Upload failed", detail, fullError: error?.toString() },
      { status: 500 },
    );
  }
}
