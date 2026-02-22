import { NextResponse } from "next/server";
import { getKnowledgeDocuments } from "@/utils/actions";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = "guest";

  const documents = await getKnowledgeDocuments(userId);
  return NextResponse.json({ documents });
}
