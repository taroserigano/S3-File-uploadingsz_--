/**
 * Streaming SSE proxy for TravelAgent itinerary generation.
 * Forwards Server-Sent Events from the Python agentic service to the frontend.
 */

const AGENTIC_SERVICE_URL =
  process.env.AGENTIC_SERVICE_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(request) {
  const userId = "guest";

  try {
    const body = await request.json();
    const { city, country, days, budget, preferences } = body;

    if (!city || !days) {
      return new Response(JSON.stringify({ error: "City and days are required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Call the streaming endpoint on the agentic service
    const response = await fetch(
      `${AGENTIC_SERVICE_URL}/api/v1/agentic/generate-itinerary-stream`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
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
      return new Response(
        JSON.stringify({ error: errorData.detail || "Failed to generate itinerary" }),
        { status: response.status, headers: { "Content-Type": "application/json" } }
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
    console.error("Error in streaming itinerary generation:", error);
    return new Response(
      JSON.stringify({ error: "Failed to generate itinerary" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
