import { NextResponse } from "next/server";

const VAULT_API_URL = process.env.VAULT_API_URL;

export async function POST(request) {
  const userId = "guest";

  if (!VAULT_API_URL) {
    return NextResponse.json(
      { error: "Vault service not configured" },
      { status: 500 }
    );
  }

  try {
    const { query, top_k = 3 } = await request.json();

    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Query string is required" },
        { status: 400 }
      );
    }

    const response = await fetch(`${VAULT_API_URL}/vault/query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query,
        user_id: userId,
        top_k,
      }),
    });

    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload?.detail || "Query failed");
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (error) {
    console.error("[VAULT QUERY] Error:", error);
    return NextResponse.json(
      {
        error: "Query failed",
        detail: error.message,
      },
      { status: 500 }
    );
  }
}
