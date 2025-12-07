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
  const activityDatabase = {
    adventure: [
      {
        name: "Mountain Hiking Trail",
        address: "Mount Takao Trailhead, 2177 Takaomachi, Hachioji",
        type: "Outdoor Adventure",
      },
      {
        name: "Rock Climbing Center",
        address: "5-3-2 Asakusa, Taito City",
        type: "Adventure Sport",
      },
      {
        name: "Zip Line Adventure Park",
        address: "1-8-1 Shibuya, Shibuya City",
        type: "Thrill Activity",
      },
      {
        name: "Mountain Bike Trails",
        address: "Yoyogi Park, 2-1 Yoyogikamizonocho, Shibuya",
        type: "Outdoor Sport",
      },
    ],
    culture: [
      {
        name: "National Museum",
        address: "13-9 Ueno Park, Taito City",
        type: "Museum",
      },
      {
        name: "Historic Temple District",
        address: "2-3-1 Asakusa, Taito City",
        type: "Historical Site",
      },
      {
        name: "Contemporary Art Gallery",
        address: "6-10-1 Roppongi, Minato City",
        type: "Art Gallery",
      },
      {
        name: "Traditional Theater",
        address: "4-12-15 Ginza, Chuo City",
        type: "Cultural Venue",
      },
    ],
    food: [
      {
        name: "Tsukiji Outer Market",
        address: "4-16-2 Tsukiji, Chuo City",
        type: "Food Market",
      },
      {
        name: "Sushi Making Class",
        address: "3-7-12 Shibuya, Shibuya City",
        type: "Cooking Experience",
      },
      {
        name: "Ramen Alley",
        address: "1-1-2 Shinjuku, Shinjuku City",
        type: "Dining District",
      },
      {
        name: "Street Food Night Market",
        address: "2-5-8 Harajuku, Shibuya City",
        type: "Food Tour",
      },
    ],
    relaxation: [
      {
        name: "Traditional Onsen Spa",
        address: "1-15-3 Odaiba, Minato City",
        type: "Spa & Wellness",
      },
      {
        name: "Seaside Beach Resort",
        address: "Odaiba Seaside Park, 1-4 Daiba, Minato",
        type: "Beach",
      },
      {
        name: "Sunset Observatory",
        address: "Tokyo Skytree, 1-1-2 Oshiage, Sumida",
        type: "Scenic View",
      },
      {
        name: "Zen Meditation Temple",
        address: "5-5-1 Shiba, Minato City",
        type: "Meditation Center",
      },
    ],
    nature: [
      {
        name: "Imperial Palace Gardens",
        address: "1-1 Chiyoda, Chiyoda City",
        type: "Garden",
      },
      {
        name: "Botanical Paradise Garden",
        address: "5-16-3 Koishikawa, Bunkyo City",
        type: "Botanical Garden",
      },
      {
        name: "Wildlife Observation Park",
        address: "Ueno Zoo, 9-83 Ueno Park, Taito",
        type: "Nature Reserve",
      },
      {
        name: "Mountain Scenic Overlook",
        address: "Mount Takao Summit, Hachioji",
        type: "Viewpoint",
      },
    ],
    shopping: [
      {
        name: "Traditional Crafts Market",
        address: "Nakamise Street, 1-36-3 Asakusa, Taito",
        type: "Market",
      },
      {
        name: "Luxury Shopping District",
        address: "5-2-1 Ginza, Chuo City",
        type: "Shopping Street",
      },
      {
        name: "Souvenir Arcade",
        address: "1-19-24 Kabukicho, Shinjuku",
        type: "Shopping Center",
      },
      {
        name: "Pottery Workshop",
        address: "3-12-8 Kagurazaka, Shinjuku",
        type: "Craft Studio",
      },
    ],
  };

  const restaurantDatabase = [
    {
      name: "Sakura Sushi Restaurant",
      address: "2-7-4 Tsukiji, Chuo City",
      type: "Sushi",
      price: "$$-$$$",
    },
    {
      name: "Ramen Ichiban",
      address: "3-38-1 Shinjuku, Shinjuku City",
      type: "Ramen",
      price: "$-$$",
    },
    {
      name: "Tempura Yamamoto",
      address: "4-5-11 Ginza, Chuo City",
      type: "Tempura",
      price: "$$$",
    },
    {
      name: "Kaiseki Garden",
      address: "2-15-2 Roppongi, Minato City",
      type: "Traditional",
      price: "$$$$",
    },
    {
      name: "Yakiniku Paradise",
      address: "1-22-7 Shibuya, Shibuya City",
      type: "BBQ",
      price: "$$-$$$",
    },
    {
      name: "Udon House",
      address: "5-9-1 Asakusa, Taito City",
      type: "Noodles",
      price: "$",
    },
    {
      name: "Izakaya Tanaka",
      address: "2-12-3 Ebisu, Shibuya City",
      type: "Pub Food",
      price: "$$",
    },
    {
      name: "Teppanyaki Fusion",
      address: "6-3-1 Roppongi, Minato City",
      type: "Teppanyaki",
      price: "$$$",
    },
    {
      name: "Tonkatsu Master",
      address: "3-14-5 Akasaka, Minato City",
      type: "Tonkatsu",
      price: "$$",
    },
    {
      name: "Soba Noodle Bar",
      address: "1-8-9 Kanda, Chiyoda City",
      type: "Soba",
      price: "$-$$",
    },
    {
      name: "Okonomiyaki House",
      address: "2-19-4 Harajuku, Shibuya City",
      type: "Okonomiyaki",
      price: "$$",
    },
    {
      name: "Shabu-Shabu Delight",
      address: "5-7-2 Shibuya, Shibuya City",
      type: "Hot Pot",
      price: "$$-$$$",
    },
    {
      name: "Wagyu Steakhouse",
      address: "4-2-8 Ginza, Chuo City",
      type: "Steak",
      price: "$$$$",
    },
    {
      name: "Bento Corner",
      address: "2-5-3 Shinjuku, Shinjuku City",
      type: "Bento",
      price: "$",
    },
    {
      name: "Curry Village",
      address: "3-11-6 Ikebukuro, Toshima City",
      type: "Curry",
      price: "$-$$",
    },
    {
      name: "Seafood Harbor",
      address: "1-4-7 Toyosu, Koto City",
      type: "Seafood",
      price: "$$$",
    },
    {
      name: "Robata Grill",
      address: "2-22-1 Ebisu, Shibuya City",
      type: "Grilled",
      price: "$$-$$$",
    },
    {
      name: "Vegan Garden Tokyo",
      address: "4-8-3 Omotesando, Shibuya City",
      type: "Vegan",
      price: "$$",
    },
    {
      name: "Yakitori Alley",
      address: "1-2-5 Yurakucho, Chiyoda City",
      type: "Yakitori",
      price: "$$",
    },
    {
      name: "Cafe Mocha Dreams",
      address: "3-6-9 Daikanyama, Shibuya City",
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
      location: { latitude: 35.6762, longitude: 139.6503 },
      address: {
        lines: ["123 Main Street"],
        cityName: destination,
        countryCode: "JP",
      },
      price: { total: "150", currency: "USD" },
      rating: 4.5,
    },
    {
      id: "hotel2",
      name: `${destination} Plaza`,
      location: { latitude: 35.6812, longitude: 139.7671 },
      address: {
        lines: ["456 Central Avenue"],
        cityName: destination,
        countryCode: "JP",
      },
      price: { total: "120", currency: "USD" },
      rating: 4.2,
    },
    {
      id: "hotel3",
      name: `Boutique ${destination} Inn`,
      location: { latitude: 35.6595, longitude: 139.7004 },
      address: {
        lines: ["789 Garden Road"],
        cityName: destination,
        countryCode: "JP",
      },
      price: { total: "95", currency: "USD" },
      rating: 4.0,
    },
  ];
}

function generateMockFlights(destination) {
  return [
    {
      id: "flight1",
      price: { total: "650", currency: "USD" },
      itineraries: [
        {
          duration: "PT12H30M",
          segments: [
            {
              departure: { airport: "LAX", time: "2026-01-20T10:00:00" },
              arrival: { airport: "NRT", time: "2026-01-21T14:30:00" },
              carrier: "AA",
              flight_number: "170",
            },
          ],
        },
        {
          duration: "PT11H45M",
          segments: [
            {
              departure: { airport: "NRT", time: "2026-01-22T16:00:00" },
              arrival: { airport: "LAX", time: "2026-01-22T10:45:00" },
              carrier: "AA",
              flight_number: "171",
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
          duration: "PT13H15M",
          segments: [
            {
              departure: { airport: "LAX", time: "2026-01-20T14:00:00" },
              arrival: { airport: "HND", time: "2026-01-21T18:15:00" },
              carrier: "UA",
              flight_number: "32",
            },
          ],
        },
        {
          duration: "PT12H30M",
          segments: [
            {
              departure: { airport: "HND", time: "2026-01-22T12:00:00" },
              arrival: { airport: "LAX", time: "2026-01-22T07:30:00" },
              carrier: "UA",
              flight_number: "33",
            },
          ],
        },
      ],
    },
  ];
}
