import { NextResponse } from "next/server";
import prisma from "@/utils/db";

export const dynamic = 'force-dynamic';

export async function POST(request) {
  const userId = "guest";

  try {
    const body = await request.json();
    const { itinerary } = body;

    if (!itinerary || !itinerary.tour) {
      return NextResponse.json(
        { error: "Invalid itinerary data" },
        { status: 400 }
      );
    }

    // Save trip to database (reusing the Tour model)
    const tour = await prisma.tour.create({
      data: {
        userId: userId,
        title: itinerary.tour.title || "My Trip",
        description: itinerary.tour.description || "",
        city: itinerary.tour.city || "",
        country: itinerary.tour.country || "",
        image: itinerary.tour.image || "",
        tags: [],
        duration: "custom",
        isFeatured: false,
        metadata: {
          run_id: itinerary.run_id,
          stops: itinerary.tour.stops || [],
          compliance: itinerary.tour.compliance || {},
          research: itinerary.tour.research || {},
          citations: itinerary.citations || [],
          cost: itinerary.cost || {},
        },
      },
    });

    return NextResponse.json({
      id: tour.id,
      title: tour.title,
      description: tour.description,
      city: tour.city,
      country: tour.country,
      createdAt: tour.createdAt,
    });
  } catch (error) {
    console.error("Error saving trip:", error);
    return NextResponse.json(
      { error: "Failed to save trip" },
      { status: 500 }
    );
  }
}

