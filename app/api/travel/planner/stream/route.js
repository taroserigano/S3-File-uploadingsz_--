/**
 * Streaming SSE proxy for TravelPlanner itinerary generation.
 * Forwards Server-Sent Events from the Python agentic service to the frontend.
 * Falls back to the non-streaming /api/travel/planner endpoint on error.
 */

const AGENTIC_SERVICE_URL =
  process.env.AGENTIC_SERVICE_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const userId = "guest";

  try {
    const body = await request.json();
    const { destination, country, days, budget, preferences } = body;

    if (!destination || !days) {
      return new Response(
        JSON.stringify({ error: "Destination and days are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    // Call the streaming plan endpoint on the agentic service
    // Backend expects preferences as list[str] of active keys
    const prefsList = preferences
      ? Object.entries(preferences)
          .filter(([, v]) => v)
          .map(([k]) => k)
      : [];

    const response = await fetch(
      `${AGENTIC_SERVICE_URL}/api/v1/agentic/generate-itinerary-stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: destination,
          country: country || destination,
          days: parseInt(days),
          budget: budget ? parseFloat(budget) : null,
          preferences: prefsList,
          user_id: userId,
        }),
      },
    );

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({
        detail: "Failed to generate trip plan",
      }));
      return new Response(
        JSON.stringify({
          error: errorData.detail || "Failed to generate trip plan",
        }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    // Forward the SSE stream directly to the client
    return new Response(response.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("Error in streaming trip plan generation:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate trip plan" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}
