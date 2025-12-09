const VAULT_API_URL = process.env.VAULT_API_URL;

export async function POST(request) {
  try {
    const userId = "guest";

    // Parse request body
    const body = await request.json();
    const { query, top_k = 3 } = body;

    if (!query || typeof query !== "string") {
      return new Response(
        JSON.stringify({ error: "Invalid query parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Call Lambda (non-streaming) and adapt to SSE expected by client
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

    if (!response.ok) {
      const errorText = await response.text();
      return new Response(
        JSON.stringify({ error: `Streaming query failed: ${errorText}` }),
        {
          status: response.status,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    const result = await response.json();

    const stream = new ReadableStream({
      start(controller) {
        const send = (obj) => {
          controller.enqueue(`data: ${JSON.stringify(obj)}\n\n`);
        };

        // Citations (sources)
        if (result?.sources) {
          send({ type: "citations", content: result.sources });
        }

        // Answer as single token payload
        if (result?.answer) {
          send({ type: "token", content: result.answer });
        }

        // Done signal
        send({ type: "done" });
        controller.close();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    console.error("[VAULT QUERY STREAM] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}
