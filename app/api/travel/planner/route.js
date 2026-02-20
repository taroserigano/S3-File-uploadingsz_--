import { NextResponse } from "next/server";

const AGENTIC_SERVICE_URL =
  process.env.AGENTIC_SERVICE_URL || "http://localhost:8000";

export const dynamic = "force-dynamic";

export async function POST(request) {
  // No auth - using guest user
  const userId = "guest";

  try {
    const body = await request.json();
    const {
      destination,
      country,
      days,
      budget,
      checkIn,
      checkOut,
      preferences,
    } = body;

    // Log preferences for debugging/testing
    console.log("Received planner request. Preferences:", preferences);

    if (!destination || !days) {
      return NextResponse.json(
        { error: "Destination and days are required" },
        { status: 400 }
      );
    }

    let itineraryData = null;
    let hotels = [];
    let flights = [];

    // Try to generate itinerary with agentic service
    try {
      const planResponse = await fetch(
        `${AGENTIC_SERVICE_URL}/api/agentic/plan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: destination,
            country: country || destination,
            days: parseInt(days),
            budget: budget ? parseFloat(budget) : null,
            preferences: preferences || {},
            user_id: userId,
          }),
        }
      );

      if (planResponse.ok) {
        const backendData = await planResponse.json();
        // Backend returns { run_id, tour, cost }

        // Transform Lambda response to match frontend expectations
        const tour = backendData.tour || backendData.itinerary || backendData;

        // Lambda returns daily_plans[].plan[] but frontend expects daily_plans[].activities[]
        // Also need to map field names: activity -> name, notes -> description
        if (tour.daily_plans) {
          tour.daily_plans = tour.daily_plans.map((day) => ({
            ...day,
            title: day.theme || day.title, // Ensure title exists
            activities: (day.plan || day.activities || []).map((activity) => ({
              time: activity.time,
              name: activity.activity || activity.name,
              description: activity.notes || activity.description,
              location:
                typeof activity.location === "string"
                  ? { address: activity.location, type: "location" }
                  : activity.location,
              duration: activity.duration,
            })),
          }));
        }

        // Fallback: if daily_plans doesn't exist, use daily_schedule
        if (!tour.daily_plans && tour.daily_schedule) {
          tour.daily_plans = tour.daily_schedule.map((day) => ({
            ...day,
            title: day.theme || day.title,
            activities: (day.activities || []).map((activity) => ({
              time: activity.time,
              name: activity.activity || activity.name,
              description: activity.notes || activity.description,
              location:
                typeof activity.location === "string"
                  ? { address: activity.location, type: "location" }
                  : activity.location,
              duration: activity.duration,
            })),
          }));
        }

        itineraryData = {
          itinerary: tour,
          run_id: backendData.run_id,
          cost: backendData.cost,
        };

        // Extract hero image from tour if available
        if (tour.hero_image) {
          itineraryData.itinerary.hero_image = tour.hero_image;
        }
      } else {
        console.warn("Agentic service unavailable, using fallback");
        // Generate a simple fallback itinerary
        itineraryData = generateFallbackItinerary(
          destination,
          country,
          days,
          preferences
        );
      }
    } catch (err) {
      console.error("Agentic service error:", err);
      // Generate a simple fallback itinerary
      itineraryData = generateFallbackItinerary(
        destination,
        country,
        days,
        preferences
      );
    }

    // Generate mock hotel data for demonstration
    if (checkIn && checkOut) {
      hotels = generateMockHotels(destination);
    }

    // Generate mock flight data for demonstration
    flights = generateMockFlights(destination);

    return NextResponse.json({
      itinerary: itineraryData.itinerary || itineraryData,
      hotels,
      flights,
      metadata: {
        destination,
        country,
        days,
        budget,
        checkIn,
        checkOut,
        preferences,
      },
    });
  } catch (error) {
    console.error("Error generating travel plan:", error);
    return NextResponse.json(
      { error: error.message || "Failed to generate travel plan" },
      { status: 500 }
    );
  }
}

function generateFallbackItinerary(destination, country, days, preferences) {
  const city = destination;
  const activityDatabase = {
    adventure: [
      {
        name: "Mountain Hiking Trail",
        address: `Hiking Trailhead, ${city}`,
        type: "Outdoor Adventure",
      },
      {
        name: "Rock Climbing Center",
        address: `Adventure Sports Center, ${city}`,
        type: "Adventure Sport",
      },
      {
        name: "Zip Line Adventure Park",
        address: `Adventure Park, ${city}`,
        type: "Thrill Activity",
      },
      {
        name: "Mountain Bike Trails",
        address: `City Park, ${city}`,
        type: "Outdoor Sport",
      },
    ],
    culture: [
      {
        name: `${city} National Museum`,
        address: `Museum Quarter, ${city}`,
        type: "Museum",
      },
      {
        name: "Historic Old Town District",
        address: `Old Town, ${city}`,
        type: "Historical Site",
      },
      {
        name: `${city} Contemporary Art Gallery`,
        address: `Arts District, ${city}`,
        type: "Art Gallery",
      },
      {
        name: "Historic Theater & Culture Center",
        address: `Cultural Center, ${city}`,
        type: "Cultural Venue",
      },
    ],
    food: [
      {
        name: `${city} Central Market`,
        address: `Central Market, ${city}`,
        type: "Food Market",
      },
      {
        name: "Local Cuisine Cooking Class",
        address: `Culinary School, ${city}`,
        type: "Cooking Experience",
      },
      {
        name: "Street Food Quarter",
        address: `Street Food District, ${city}`,
        type: "Dining District",
      },
      {
        name: "Night Food Market",
        address: `Night Market, ${city}`,
        type: "Food Tour",
      },
    ],
    relaxation: [
      {
        name: "Luxury Day Spa & Wellness",
        address: `Spa District, ${city}`,
        type: "Spa & Wellness",
      },
      {
        name: "Scenic Riverside Promenade",
        address: `Riverside Walk, ${city}`,
        type: "Scenic Walk",
      },
      {
        name: "City Panorama Viewpoint",
        address: `Observation Deck, ${city}`,
        type: "Scenic View",
      },
      {
        name: "Tranquil City Gardens",
        address: `City Gardens, ${city}`,
        type: "Meditation Center",
      },
    ],
    nature: [
      {
        name: `${city} Royal Gardens`,
        address: `Royal Gardens, ${city}`,
        type: "Garden",
      },
      {
        name: "Botanical Garden",
        address: `Botanical Garden, ${city}`,
        type: "Botanical Garden",
      },
      {
        name: `${city} Wildlife & Nature Park`,
        address: `Nature Reserve, ${city}`,
        type: "Nature Reserve",
      },
      {
        name: "Scenic Overlook",
        address: `Scenic Viewpoint, ${city}`,
        type: "Viewpoint",
      },
    ],
    shopping: [
      {
        name: "Traditional Crafts Market",
        address: `Old Town Market, ${city}`,
        type: "Market",
      },
      {
        name: "Main Shopping District",
        address: `Shopping District, ${city}`,
        type: "Shopping Street",
      },
      {
        name: "Souvenir & Gift Shops",
        address: `Tourist Center, ${city}`,
        type: "Shopping Center",
      },
      {
        name: "Local Artisan Workshop",
        address: `Artisan Quarter, ${city}`,
        type: "Craft Studio",
      },
    ],
  };

  const restaurantDatabase = [
    {
      name: `The ${city} Kitchen`,
      address: `Old Town, ${city}`,
      type: "Local Cuisine",
      price: "$$-$$$",
    },
    {
      name: "Market Bistro",
      address: `Central Market, ${city}`,
      type: "Bistro",
      price: "$-$$",
    },
    {
      name: "Grand Brasserie",
      address: `Main Square, ${city}`,
      type: "Brasserie",
      price: "$$$",
    },
    {
      name: "Heritage Restaurant",
      address: `Heritage Quarter, ${city}`,
      type: "Traditional",
      price: "$$$$",
    },
    {
      name: "Grill & Smokehouse",
      address: `City Center, ${city}`,
      type: "BBQ",
      price: "$$-$$$",
    },
    {
      name: "Noodle & Pasta House",
      address: `Arts District, ${city}`,
      type: "Noodles",
      price: "$",
    },
    {
      name: "The Local Tavern",
      address: `Old Quarter, ${city}`,
      type: "Pub Food",
      price: "$$",
    },
    {
      name: "Fusion Kitchen",
      address: `Restaurant Row, ${city}`,
      type: "Fusion",
      price: "$$$",
    },
    {
      name: "Courtyard Café",
      address: `Cultural District, ${city}`,
      type: "Café",
      price: "$$",
    },
    {
      name: "Artisan Noodle Bar",
      address: `Market Street, ${city}`,
      type: "Noodles",
      price: "$-$$",
    },
    {
      name: "Farmhouse Table",
      address: `Food Quarter, ${city}`,
      type: "Farm-to-Table",
      price: "$$",
    },
    {
      name: "The Hot Pot Corner",
      address: `Dining District, ${city}`,
      type: "Hot Pot",
      price: "$$-$$$",
    },
    {
      name: "Prime Steakhouse",
      address: `Upscale District, ${city}`,
      type: "Steak",
      price: "$$$$",
    },
    {
      name: "Quick Bites Deli",
      address: `Downtown, ${city}`,
      type: "Deli",
      price: "$",
    },
    {
      name: "Spice Garden",
      address: `Spice Quarter, ${city}`,
      type: "Curry",
      price: "$-$$",
    },
    {
      name: "Harbor Seafood",
      address: `Waterfront, ${city}`,
      type: "Seafood",
      price: "$$$",
    },
    {
      name: "Open Fire Grill",
      address: `Grill Street, ${city}`,
      type: "Grilled",
      price: "$$-$$$",
    },
    {
      name: "Green Plate Vegan",
      address: `Health District, ${city}`,
      type: "Vegan",
      price: "$$",
    },
    {
      name: "Street Skewers & Bites",
      address: `Street Food Lane, ${city}`,
      type: "Grilled Skewers",
      price: "$$",
    },
    {
      name: "Morning Brew Café",
      address: `Café District, ${city}`,
      type: "Cafe",
      price: "$",
    },
  ];

  const selectedPreferences =
    preferences.length > 0 ? preferences : ["culture", "food"];

  // Shuffle restaurant database for randomization
  const shuffledRestaurants = [...restaurantDatabase].sort(
    () => Math.random() - 0.5
  );

  // Track used activities and restaurants to avoid duplicates
  const usedActivities = new Set();
  const usedRestaurants = new Set();
  let restaurantIndex = 0;

  const daily_plans = Array.from({ length: days }, (_, i) => {
    const day = i + 1;
    const pref = selectedPreferences[i % selectedPreferences.length];
    const activityList = activityDatabase[pref] || activityDatabase.culture;

    // Get unique morning activity
    let morningActivity =
      activityList.find((a) => !usedActivities.has(a.name)) ||
      activityList[i % activityList.length];
    usedActivities.add(morningActivity.name);

    // Get unique afternoon activity
    let afternoonActivity =
      activityList.find(
        (a) => !usedActivities.has(a.name) && a.name !== morningActivity.name
      ) || activityList[(i + 1) % activityList.length];
    usedActivities.add(afternoonActivity.name);

    // Get unique lunch spot from shuffled array
    let lunchSpot;
    do {
      lunchSpot =
        shuffledRestaurants[restaurantIndex % shuffledRestaurants.length];
      restaurantIndex++;
    } while (
      usedRestaurants.has(lunchSpot.name) &&
      restaurantIndex < shuffledRestaurants.length * 2
    );
    usedRestaurants.add(lunchSpot.name);

    // Get unique dinner spot (different from lunch)
    let dinnerSpot;
    do {
      dinnerSpot =
        shuffledRestaurants[restaurantIndex % shuffledRestaurants.length];
      restaurantIndex++;
    } while (
      (usedRestaurants.has(dinnerSpot.name) ||
        dinnerSpot.name === lunchSpot.name) &&
      restaurantIndex < shuffledRestaurants.length * 2
    );
    usedRestaurants.add(dinnerSpot.name);

    return {
      day,
      title: `Explore ${destination}`,
      theme: `${pref.charAt(0).toUpperCase() + pref.slice(1)} Day`,
      activities: [
        {
          time: "09:00",
          name: morningActivity.name,
          description: `Start your day at ${
            morningActivity.name
          }, a premier ${morningActivity.type.toLowerCase()} destination in ${destination}.`,
          location: {
            address: morningActivity.address,
            type: morningActivity.type,
          },
          estimated_duration: "2-3 hours",
          estimated_cost: "$30-50",
        },
        {
          time: "12:00",
          name: `Lunch at ${lunchSpot.name}`,
          description: `Enjoy authentic ${lunchSpot.type} cuisine at ${lunchSpot.name}.`,
          location: {
            address: lunchSpot.address,
            type: "Restaurant",
            cuisine: lunchSpot.type,
            priceRange: lunchSpot.price,
          },
          estimated_duration: "1-2 hours",
          estimated_cost: "$20-40",
        },
        {
          time: "14:00",
          name: afternoonActivity.name,
          description: `Continue your adventure at ${
            afternoonActivity.name
          }, featuring ${afternoonActivity.type.toLowerCase()} experiences.`,
          location: {
            address: afternoonActivity.address,
            type: afternoonActivity.type,
          },
          estimated_duration: "2-3 hours",
          estimated_cost: "$25-45",
        },
        {
          time: "18:00",
          name: `Dinner at ${dinnerSpot.name}`,
          description: `Savor ${dinnerSpot.type} specialties at ${dinnerSpot.name} to complete your day.`,
          location: {
            address: dinnerSpot.address,
            type: "Restaurant",
            cuisine: dinnerSpot.type,
            priceRange: dinnerSpot.price,
          },
          estimated_duration: "2-3 hours",
          estimated_cost: "$40-80",
        },
      ],
      meals: {
        breakfast: { name: "Hotel breakfast", address: "Your accommodation" },
        lunch: {
          name: lunchSpot.name,
          address: lunchSpot.address,
          type: lunchSpot.type,
        },
        dinner: {
          name: dinnerSpot.name,
          address: dinnerSpot.address,
          type: dinnerSpot.type,
        },
      },
    };
  });

  return {
    title: `${days}-Day ${destination} Adventure`,
    description: `Experience the best of ${destination}, ${
      country || destination
    } with this carefully planned ${days}-day itinerary featuring ${selectedPreferences.join(
      ", "
    )} activities.`,
    daily_plans,
  };
}

function generateMockHotels(destination) {
  return [
    {
      id: "hotel1",
      name: `Grand ${destination} Hotel`,
      location: {},
      address: {
        lines: ["123 Main Street"],
        cityName: destination,
      },
      price: { total: "150", currency: "USD" },
      rating: 4.5,
    },
    {
      id: "hotel2",
      name: `${destination} Plaza`,
      location: {},
      address: {
        lines: ["456 Central Avenue"],
        cityName: destination,
      },
      price: { total: "120", currency: "USD" },
      rating: 4.2,
    },
    {
      id: "hotel3",
      name: `Boutique ${destination} Inn`,
      location: {},
      address: {
        lines: ["789 Garden Road"],
        cityName: destination,
      },
      price: { total: "95", currency: "USD" },
      rating: 4.0,
    },
  ];
}

function generateMockFlights(destination) {
  const dest = destination.toUpperCase().slice(0, 3);
  return [
    {
      id: "flight1",
      price: { total: "650", currency: "USD" },
      itineraries: [
        {
          duration: "PT10H00M",
          segments: [
            {
              departure: { airport: "JFK", time: "2026-03-01T10:00:00" },
              arrival: { airport: dest, time: "2026-03-01T20:00:00" },
              carrier: "AA",
              flight_number: "100",
            },
          ],
        },
        {
          duration: "PT10H00M",
          segments: [
            {
              departure: { airport: dest, time: "2026-03-08T12:00:00" },
              arrival: { airport: "JFK", time: "2026-03-08T22:00:00" },
              carrier: "AA",
              flight_number: "101",
            },
          ],
        },
      ],
    },
    {
      id: "flight2",
      price: { total: "580", currency: "USD" },
      itineraries: [
        {
          duration: "PT11H00M",
          segments: [
            {
              departure: { airport: "LAX", time: "2026-03-01T14:00:00" },
              arrival: { airport: dest, time: "2026-03-02T01:00:00" },
              carrier: "UA",
              flight_number: "200",
            },
          ],
        },
        {
          duration: "PT11H00M",
          segments: [
            {
              departure: { airport: dest, time: "2026-03-08T08:00:00" },
              arrival: { airport: "LAX", time: "2026-03-08T19:00:00" },
              carrier: "UA",
              flight_number: "201",
            },
          ],
        },
      ],
    },
  ];
}
