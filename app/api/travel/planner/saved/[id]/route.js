import { NextResponse } from "next/server";
import prisma from "@/utils/db";

export const dynamic = "force-dynamic";

export async function DELETE(request, { params }) {
  try {
    const userId = "guest";
    console.log("DELETE request - Current userId:", userId);

    // In Next.js 14+, params might be a Promise
    const resolvedParams = await Promise.resolve(params);
    const { id } = resolvedParams;
    console.log("DELETE request - Trip ID:", id);

    // First, verify the trip belongs to this user
    const trip = await prisma.tripPlan.findUnique({
      where: { id },
      select: { userId: true, destination: true },
    });

    console.log("DELETE request - Found trip:", trip);

    if (!trip) {
      return NextResponse.json({ error: "Trip not found" }, { status: 404 });
    }

    console.log("DELETE request - Comparing userIds:");
    console.log(
      "  Trip userId:",
      trip.userId,
      "(type:",
      typeof trip.userId,
      ")"
    );
    console.log("  Current userId:", userId, "(type:", typeof userId, ")");
    console.log("  Are they equal?", trip.userId === userId);

    if (trip.userId !== userId) {
      return NextResponse.json(
        {
          error: "Forbidden - This trip belongs to a different user",
          debug: {
            tripUserId: trip.userId,
            currentUserId: userId,
          },
        },
        { status: 403 }
      );
    }

    // Delete the trip
    await prisma.tripPlan.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: "Trip deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting trip:", error);
    return NextResponse.json(
      { error: "Failed to delete trip" },
      { status: 500 }
    );
  }
}
