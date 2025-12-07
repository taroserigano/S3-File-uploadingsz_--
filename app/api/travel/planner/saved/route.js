import { NextResponse } from "next/server";
import prisma from "@/utils/db";

export const dynamic = "force-dynamic";

export async function GET(request) {
  try {
    const userId = "guest";

    const tripPlans = await prisma.tripPlan.findMany({
      where: {
        userId,
      },
      orderBy: {
        createdAt: "desc",
      },
      select: {
        id: true,
        createdAt: true,
        destination: true,
        country: true,
        days: true,
        checkIn: true,
        checkOut: true,
        title: true,
        heroImage: true,
        itinerary: true,
        hotels: true,
        budget: true,
        preferences: true,
      },
    });

    return NextResponse.json({
      success: true,
      tripPlans,
    });
  } catch (error) {
    console.error("Error fetching saved trip plans:", error);
    return NextResponse.json(
      { error: "Failed to fetch saved trip plans" },
      { status: 500 }
    );
  }
}
