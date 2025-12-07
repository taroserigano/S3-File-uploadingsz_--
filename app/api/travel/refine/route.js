import { NextResponse } from "next/server";

const AGENTIC_SERVICE_URL =
  process.env.AGENTIC_SERVICE_URL || "http://localhost:8000";

export async function POST(request) {
  const userId = "guest";

  try {
    const body = await request.json();
    const { run_id, current_itinerary, refinement } = body;

    if (!run_id || !current_itinerary || !refinement) {
      return NextResponse.json(
        { error: "run_id, current_itinerary, and refinement are required" },
        { status: 400 }
      );
    }

    // Call agentic service to refine itinerary
    const response = await fetch(
      `${AGENTIC_SERVICE_URL}/api/v1/agentic/refine-itinerary`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          run_id,
          current_itinerary,
          refinement,
          user_id: userId,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        detail: "Failed to refine itinerary",
      }));
      return NextResponse.json(
        { error: errorData.detail || "Failed to refine itinerary" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error refining itinerary:", error);
    return NextResponse.json(
      { error: "Failed to refine itinerary" },
      { status: 500 }
    );
  }
}

