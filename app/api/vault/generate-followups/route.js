import { NextResponse } from "next/server";

export async function POST(request) {
  const userId = "guest";

  try {
    const { query, answer } = await request.json();

    if (!query || !answer) {
      return NextResponse.json(
        { error: "Query and answer are required" },
        { status: 400 }
      );
    }

    // Call OpenAI to generate follow-up questions
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "You are a helpful assistant that generates relevant follow-up questions. Generate 3 concise follow-up questions (max 10 words each) based on the user's question and the answer provided. Return only a JSON array of strings.",
          },
          {
            role: "user",
            content: `User asked: "${query}"\n\nAnswer was: "${answer}"\n\nGenerate 3 relevant follow-up questions as a JSON array.`,
          },
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to generate follow-up questions");
    }

    const data = await response.json();
    const content = data.choices[0].message.content.trim();
    
    // Try to parse JSON response
    let questions = [];
    try {
      questions = JSON.parse(content);
      if (!Array.isArray(questions)) {
        questions = [questions];
      }
    } catch (e) {
      // If not valid JSON, split by newlines and clean up
      questions = content
        .split("\n")
        .filter((q) => q.trim().length > 0)
        .map((q) => q.replace(/^[0-9]+\.\s*/, "").replace(/^-\s*/, "").trim())
        .slice(0, 3);
    }

    return NextResponse.json({ questions: questions.slice(0, 3) });
  } catch (error) {
    console.error("Error generating follow-up questions:", error);
    return NextResponse.json(
      { error: "Failed to generate follow-up questions" },
      { status: 500 }
    );
  }
}
