import { NextResponse } from "next/server";
import prisma from "@/utils/db";

const AGENTIC_SERVICE_URL = process.env.AGENTIC_SERVICE_URL || "http://localhost:8000";

export async function GET(request, { params }) {
  const userId = "guest";

  try {
    const { id } = params;
    
    // Get document from database to verify ownership and get filename
    const document = await prisma.knowledgeDocument.findUnique({
      where: { id },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 }
      );
    }

    if (document.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    
    // Fetch preview from agentic service, pass filePath if available
    const queryParams = new URLSearchParams({
      user_id: userId,
    });
    
    if (document.filePath) {
      queryParams.append("filePath", document.filePath);
    } else if (document.filename) {
      // Fallback to filename if filePath not stored
      queryParams.append("filename", document.filename);
    }
    
    const response = await fetch(
      `${AGENTIC_SERVICE_URL}/api/v1/vault/preview/${id}?${queryParams.toString()}`,
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ detail: "Failed to fetch preview" }));
      return NextResponse.json(
        { error: errorData.detail || "Failed to fetch document preview" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error fetching document preview:", error);
    return NextResponse.json(
      { error: "Failed to fetch document preview" },
      { status: 500 }
    );
  }
}

