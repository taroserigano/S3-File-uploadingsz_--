import { NextResponse } from "next/server";
import { deleteKnowledgeDocument } from "@/utils/actions";
import prisma from "@/utils/db";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  const userId = "guest";

  try {
    const { id } = params;

    // Verify document belongs to user
    const document = await prisma.knowledgeDocument.findUnique({
      where: { id },
    });

    if (!document) {
      return NextResponse.json(
        { error: "Document not found" },
        { status: 404 },
      );
    }

    if (document.userId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Delete from database
    await deleteKnowledgeDocument(id);

    // TODO: Optionally delete from FAISS index
    // This would require calling the FastAPI endpoint to remove embeddings

    return NextResponse.json({
      success: true,
      message: "Document deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting document:", error);
    return NextResponse.json(
      { error: "Failed to delete document" },
      { status: 500 },
    );
  }
}
