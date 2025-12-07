import { NextResponse } from "next/server";

const AGENTIC_SERVICE_URL =
  process.env.AGENTIC_SERVICE_URL || "http://localhost:8000";

export async function POST(request) {
  const userId = "guest";

  try {
    const body = await request.json();
    const { city, country, days, budget, preferences } = body;

    // Validate required fields
    if (!city || !days) {
      return NextResponse.json(
        { error: "City and days are required" },
        { status: 400 }
      );
    }

    if (days < 1 || days > 30) {
      return NextResponse.json(
        { error: "Days must be between 1 and 30" },
        { status: 400 }
      );
    }

    // Call agentic service to generate itinerary
    const response = await fetch(
      `${AGENTIC_SERVICE_URL}/api/v1/agentic/generate-itinerary`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          city,
          country: country || "Auto-detect",
          days: parseInt(days),
          budget: budget ? parseFloat(budget) : null,
          preferences: preferences || [],
          user_id: userId,
        }),
      }
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        detail: "Failed to generate itinerary",
      }));
      return NextResponse.json(
        { error: errorData.detail || "Failed to generate itinerary" },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    console.error("Error generating itinerary:", error);
    return NextResponse.json(
      { error: "Failed to generate itinerary" },
      { status: 500 }
    );
  }
}

