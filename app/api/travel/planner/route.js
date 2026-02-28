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
        { status: 400 },
      );
    }

    let itineraryData = null;
    let hotels = [];
    let flights = [];

    // Try to generate itinerary with agentic service (with 60s timeout)
    try {
      const agenticController = new AbortController();
      const agenticTimeout = setTimeout(() => agenticController.abort(), 60000);

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
          signal: agenticController.signal,
        },
      );

      clearTimeout(agenticTimeout);

      if (planResponse.ok) {
        const backendData = await planResponse.json();
        // Backend returns { run_id, tour, cost }

        // Detect failed generation (Lambda returns 200 with empty tour and status:"failed")
        const tourPayload =
          backendData.tour || backendData.itinerary || backendData;
        const isFailed =
          backendData.status === "failed" ||
          !tourPayload ||
          (typeof tourPayload === "object" &&
            Object.keys(tourPayload).length === 0);

        if (isFailed) {
          console.warn(
            "Agentic service returned empty/failed result, using fallback",
          );
          itineraryData = generateFallbackItinerary(
            destination,
            country,
            days,
            preferences,
          );
        } else {
          // Transform Lambda response to match frontend expectations
          const tour = tourPayload;

          // Lambda returns daily_plans[].plan[] but frontend expects daily_plans[].activities[]
          // Also need to map field names: activity -> name, notes -> description
          if (tour.daily_plans) {
            tour.daily_plans = tour.daily_plans.map((day) => ({
              ...day,
              title: day.theme || day.title, // Ensure title exists
              activities: (day.plan || day.activities || []).map(
                (activity) => ({
                  time: activity.time,
                  name: activity.activity || activity.name,
                  description: activity.notes || activity.description,
                  location:
                    typeof activity.location === "string"
                      ? { address: activity.location, type: "location" }
                      : activity.location,
                  duration: activity.duration,
                }),
              ),
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
        } // end of isFailed else block
      } else {
        console.warn("Agentic service unavailable, using fallback");
        // Generate a simple fallback itinerary
        itineraryData = generateFallbackItinerary(
          destination,
          country,
          days,
          preferences,
        );
      }
    } catch (err) {
      console.error("Agentic service error:", err);
      // Generate a simple fallback itinerary
      itineraryData = generateFallbackItinerary(
        destination,
        country,
        days,
        preferences,
      );
    }

    // Generate mock flight data for demonstration
    flights = generateMockFlights(destination);

    // Ensure recommended_hotels is always inside itinerary
    const itinerary = itineraryData.itinerary || itineraryData;
    if (
      !itinerary.recommended_hotels ||
      itinerary.recommended_hotels.length === 0
    ) {
      itinerary.recommended_hotels = [
        {
          name: `Grand ${destination} Hotel`,
          rating: 4.5,
          price_range: "$150-250/night",
          address: `City Center, ${destination}`,
          description: `Luxury hotel in the heart of ${destination} with excellent amenities.`,
        },
        {
          name: `${destination} Budget Inn`,
          rating: 3.8,
          price_range: "$60-100/night",
          address: `Downtown ${destination}`,
          description: `Affordable accommodation near public transport and dining.`,
        },
        {
          name: `Boutique ${destination} Suites`,
          rating: 4.2,
          price_range: "$120-180/night",
          address: `${destination} Arts District`,
          description: `Charming boutique hotel with unique decor and personalized service.`,
        },
      ];
    }

    return NextResponse.json({
      itinerary,
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
      { status: 500 },
    );
  }
}

function generateFallbackItinerary(destination, country, days, preferences) {
  // ── Per-city activity & restaurant databases ──────────────────────────
  const cityData = {
    "new york": {
      adventure: [
        {
          name: "Central Park Bike Tour",
          address: "59th St & 5th Ave, New York, NY",
          type: "Outdoor Adventure",
        },
        {
          name: "Brooklyn Bridge Walk",
          address: "Brooklyn Bridge, New York, NY",
          type: "Scenic Walk",
        },
        {
          name: "Hudson River Kayaking",
          address: "Pier 26, Hudson River Park, NY",
          type: "Water Sport",
        },
        {
          name: "Chelsea Piers Sports Complex",
          address: "62 Chelsea Piers, New York, NY",
          type: "Adventure Sport",
        },
      ],
      culture: [
        {
          name: "Metropolitan Museum of Art",
          address: "1000 5th Ave, New York, NY",
          type: "Museum",
        },
        {
          name: "Statue of Liberty & Ellis Island",
          address: "Liberty Island, New York, NY",
          type: "Historical Site",
        },
        {
          name: "Museum of Modern Art (MoMA)",
          address: "11 W 53rd St, New York, NY",
          type: "Art Gallery",
        },
        {
          name: "Broadway Show District",
          address: "Times Square, Manhattan, NY",
          type: "Cultural Venue",
        },
      ],
      food: [
        {
          name: "Chelsea Market Food Hall",
          address: "75 9th Ave, New York, NY",
          type: "Food Market",
        },
        {
          name: "Smorgasburg Brooklyn",
          address: "90 Kent Ave, Brooklyn, NY",
          type: "Food Tour",
        },
        {
          name: "Little Italy Walking Tour",
          address: "Mulberry St, Manhattan, NY",
          type: "Dining District",
        },
        {
          name: "Pizza Making Class",
          address: "234 W 14th St, New York, NY",
          type: "Cooking Experience",
        },
      ],
      relaxation: [
        {
          name: "Central Park Conservatory Garden",
          address: "1233 5th Ave, New York, NY",
          type: "Garden",
        },
        {
          name: "The Spa at Mandarin Oriental",
          address: "80 Columbus Cir, New York, NY",
          type: "Spa & Wellness",
        },
        {
          name: "Top of the Rock Observation",
          address: "30 Rockefeller Plaza, New York, NY",
          type: "Scenic View",
        },
        {
          name: "Brooklyn Botanic Garden",
          address: "990 Washington Ave, Brooklyn, NY",
          type: "Garden",
        },
      ],
      nature: [
        {
          name: "Central Park",
          address: "Central Park, Manhattan, NY",
          type: "Park",
        },
        {
          name: "The High Line",
          address: "Gansevoort St to 34th St, New York, NY",
          type: "Urban Nature Walk",
        },
        {
          name: "New York Botanical Garden",
          address: "2900 Southern Blvd, Bronx, NY",
          type: "Botanical Garden",
        },
        {
          name: "Prospect Park",
          address: "Prospect Park, Brooklyn, NY",
          type: "Park",
        },
      ],
      shopping: [
        {
          name: "Fifth Avenue Shopping",
          address: "5th Ave, Midtown Manhattan, NY",
          type: "Shopping Street",
        },
        {
          name: "SoHo Boutique District",
          address: "SoHo, Manhattan, NY",
          type: "Shopping District",
        },
        {
          name: "Brooklyn Flea Market",
          address: "80 Pearl St, Brooklyn, NY",
          type: "Market",
        },
        {
          name: "Williamsburg Vintage Shops",
          address: "Bedford Ave, Brooklyn, NY",
          type: "Shopping District",
        },
      ],
      restaurants: [
        {
          name: "Joe's Pizza",
          address: "7 Carmine St, New York, NY",
          type: "Pizza",
          price: "$",
        },
        {
          name: "Katz's Delicatessen",
          address: "205 E Houston St, New York, NY",
          type: "Deli",
          price: "$$",
        },
        {
          name: "Peter Luger Steak House",
          address: "178 Broadway, Brooklyn, NY",
          type: "Steak",
          price: "$$$$",
        },
        {
          name: "Le Bernadin",
          address: "155 W 51st St, New York, NY",
          type: "French Seafood",
          price: "$$$$",
        },
        {
          name: "Shake Shack",
          address: "Madison Square Park, New York, NY",
          type: "Burgers",
          price: "$",
        },
        {
          name: "Di Fara Pizza",
          address: "1424 Ave J, Brooklyn, NY",
          type: "Pizza",
          price: "$$",
        },
        {
          name: "Levain Bakery",
          address: "167 W 74th St, New York, NY",
          type: "Bakery",
          price: "$",
        },
        {
          name: "The Halal Guys",
          address: "W 53rd St & 6th Ave, New York, NY",
          type: "Street Food",
          price: "$",
        },
        {
          name: "Momofuku Noodle Bar",
          address: "171 1st Ave, New York, NY",
          type: "Asian Fusion",
          price: "$$$",
        },
        {
          name: "Grimaldi's Pizzeria",
          address: "1 Front St, Brooklyn, NY",
          type: "Pizza",
          price: "$$",
        },
        {
          name: "Blue Ribbon Sushi",
          address: "119 Sullivan St, New York, NY",
          type: "Sushi",
          price: "$$$",
        },
        {
          name: "Los Tacos No. 1",
          address: "75 9th Ave, New York, NY",
          type: "Mexican",
          price: "$",
        },
        {
          name: "Russ & Daughters",
          address: "179 E Houston St, New York, NY",
          type: "Jewish Deli",
          price: "$$",
        },
        {
          name: "Carbone",
          address: "181 Thompson St, New York, NY",
          type: "Italian",
          price: "$$$$",
        },
        {
          name: "Balthazar",
          address: "80 Spring St, New York, NY",
          type: "French Bistro",
          price: "$$$",
        },
        {
          name: "The Smith",
          address: "956 2nd Ave, New York, NY",
          type: "American",
          price: "$$",
        },
        {
          name: "Xi'an Famous Foods",
          address: "45 Bayard St, New York, NY",
          type: "Chinese",
          price: "$",
        },
        {
          name: "Black Tap",
          address: "529 Broome St, New York, NY",
          type: "Burgers",
          price: "$$",
        },
        {
          name: "Eataly NYC",
          address: "200 5th Ave, New York, NY",
          type: "Italian Market",
          price: "$$-$$$",
        },
        {
          name: "The Diner Brooklyn",
          address: "85 Broadway, Brooklyn, NY",
          type: "American",
          price: "$$",
        },
      ],
    },
    tokyo: {
      adventure: [
        {
          name: "Mount Takao Hiking Trail",
          address: "2177 Takaomachi, Hachioji, Tokyo",
          type: "Outdoor Adventure",
        },
        {
          name: "Rock Climbing at B-Pump",
          address: "5-3-2 Asakusa, Taito City, Tokyo",
          type: "Adventure Sport",
        },
        {
          name: "TeamLab Borderless",
          address: "1-3-8 Aomi, Koto City, Tokyo",
          type: "Immersive Experience",
        },
        {
          name: "Go-Kart Street Tour",
          address: "1-8-1 Shibuya, Shibuya City, Tokyo",
          type: "Thrill Activity",
        },
      ],
      culture: [
        {
          name: "Tokyo National Museum",
          address: "13-9 Ueno Park, Taito City, Tokyo",
          type: "Museum",
        },
        {
          name: "Senso-ji Temple",
          address: "2-3-1 Asakusa, Taito City, Tokyo",
          type: "Historical Site",
        },
        {
          name: "Mori Art Museum",
          address: "6-10-1 Roppongi, Minato City, Tokyo",
          type: "Art Gallery",
        },
        {
          name: "Kabuki-za Theatre",
          address: "4-12-15 Ginza, Chuo City, Tokyo",
          type: "Cultural Venue",
        },
      ],
      food: [
        {
          name: "Tsukiji Outer Market",
          address: "4-16-2 Tsukiji, Chuo City, Tokyo",
          type: "Food Market",
        },
        {
          name: "Sushi Making Class",
          address: "3-7-12 Shibuya, Shibuya City, Tokyo",
          type: "Cooking Experience",
        },
        {
          name: "Shinjuku Ramen Street",
          address: "1-1-2 Shinjuku, Shinjuku City, Tokyo",
          type: "Dining District",
        },
        {
          name: "Harajuku Street Food Tour",
          address: "Takeshita-dori, Shibuya City, Tokyo",
          type: "Food Tour",
        },
      ],
      relaxation: [
        {
          name: "Oedo Onsen Monogatari",
          address: "2-6-3 Aomi, Koto City, Tokyo",
          type: "Spa & Wellness",
        },
        {
          name: "Odaiba Seaside Park",
          address: "1-4 Daiba, Minato City, Tokyo",
          type: "Beach",
        },
        {
          name: "Tokyo Skytree Observatory",
          address: "1-1-2 Oshiage, Sumida City, Tokyo",
          type: "Scenic View",
        },
        {
          name: "Zojo-ji Temple Meditation",
          address: "4-7-35 Shibakoen, Minato City, Tokyo",
          type: "Meditation Center",
        },
      ],
      nature: [
        {
          name: "Imperial Palace East Gardens",
          address: "1-1 Chiyoda, Chiyoda City, Tokyo",
          type: "Garden",
        },
        {
          name: "Koishikawa Korakuen Garden",
          address: "1-6-6 Koraku, Bunkyo City, Tokyo",
          type: "Botanical Garden",
        },
        {
          name: "Ueno Zoo",
          address: "9-83 Ueno Park, Taito City, Tokyo",
          type: "Nature Reserve",
        },
        {
          name: "Meiji Jingu Forest",
          address: "1-1 Yoyogikamizonocho, Shibuya City, Tokyo",
          type: "Forest",
        },
      ],
      shopping: [
        {
          name: "Nakamise Shopping Street",
          address: "1-36-3 Asakusa, Taito City, Tokyo",
          type: "Market",
        },
        {
          name: "Ginza Six",
          address: "6-10-1 Ginza, Chuo City, Tokyo",
          type: "Shopping Street",
        },
        {
          name: "Akihabara Electric Town",
          address: "Akihabara, Chiyoda City, Tokyo",
          type: "Shopping District",
        },
        {
          name: "Shibuya 109",
          address: "2-29-1 Dogenzaka, Shibuya City, Tokyo",
          type: "Shopping Center",
        },
      ],
      restaurants: [
        {
          name: "Ichiran Ramen",
          address: "1-22-7 Jinnan, Shibuya City, Tokyo",
          type: "Ramen",
          price: "$-$$",
        },
        {
          name: "Sushi Dai",
          address: "6-5 Toyosu, Koto City, Tokyo",
          type: "Sushi",
          price: "$$$",
        },
        {
          name: "Afuri Ramen",
          address: "1-1-7 Ebisu, Shibuya City, Tokyo",
          type: "Ramen",
          price: "$",
        },
        {
          name: "Tonkatsu Maisen",
          address: "4-8-5 Jingumae, Shibuya City, Tokyo",
          type: "Tonkatsu",
          price: "$$",
        },
        {
          name: "Genki Sushi",
          address: "1-13-11 Shibuya, Shibuya City, Tokyo",
          type: "Sushi",
          price: "$",
        },
        {
          name: "Tsuta Ramen",
          address: "1-14-1 Sugamo, Toshima City, Tokyo",
          type: "Ramen",
          price: "$$",
        },
        {
          name: "Tempura Kondo",
          address: "5-5-13 Ginza, Chuo City, Tokyo",
          type: "Tempura",
          price: "$$$$",
        },
        {
          name: "Gyukatsu Motomura",
          address: "3-18-17 Shinjuku, Shinjuku City, Tokyo",
          type: "Gyukatsu",
          price: "$$",
        },
        {
          name: "Uobei Sushi",
          address: "1-4-7 Jinnan, Shibuya City, Tokyo",
          type: "Sushi",
          price: "$",
        },
        {
          name: "Narisawa",
          address: "2-6-15 Minami-Aoyama, Minato City, Tokyo",
          type: "French-Japanese",
          price: "$$$$",
        },
        {
          name: "Fuunji Tsukemen",
          address: "2-14-3 Yoyogi, Shibuya City, Tokyo",
          type: "Tsukemen",
          price: "$",
        },
        {
          name: "Yakiniku Champion",
          address: "3-2-17 Shibuya, Shibuya City, Tokyo",
          type: "Yakiniku",
          price: "$$$",
        },
        {
          name: "CoCo Ichibanya Curry",
          address: "5-17-13 Shinjuku, Shinjuku City, Tokyo",
          type: "Curry",
          price: "$",
        },
        {
          name: "Ippudo Ramen",
          address: "1-3-26 Hiroo, Shibuya City, Tokyo",
          type: "Ramen",
          price: "$$",
        },
        {
          name: "Gonpachi Nishi-Azabu",
          address: "1-13-11 Nishi-Azabu, Minato City, Tokyo",
          type: "Izakaya",
          price: "$$$",
        },
        {
          name: "Daiwa Sushi",
          address: "6-5-1 Toyosu, Koto City, Tokyo",
          type: "Sushi",
          price: "$$$",
        },
        {
          name: "Harajuku Gyoza Lou",
          address: "6-2-4 Jingumae, Shibuya City, Tokyo",
          type: "Gyoza",
          price: "$",
        },
        {
          name: "Den Tokyo",
          address: "2-3-18 Jingumae, Shibuya City, Tokyo",
          type: "Japanese",
          price: "$$$$",
        },
        {
          name: "Tsukiji Sushiko",
          address: "4-13-9 Tsukiji, Chuo City, Tokyo",
          type: "Sushi",
          price: "$$",
        },
        {
          name: "Menya Musashi",
          address: "2-4-5 Shinjuku, Shinjuku City, Tokyo",
          type: "Ramen",
          price: "$",
        },
      ],
    },
    paris: {
      adventure: [
        {
          name: "Seine River Cruise",
          address: "Port de la Bourdonnais, 75007 Paris",
          type: "Scenic Cruise",
        },
        {
          name: "Catacombs of Paris",
          address: "1 Ave du Colonel Henri Rol-Tanguy, 75014 Paris",
          type: "Underground Tour",
        },
        {
          name: "Versailles Bike Tour",
          address: "Place d'Armes, 78000 Versailles",
          type: "Outdoor Adventure",
        },
        {
          name: "Eiffel Tower Stairs Climb",
          address: "Champ de Mars, 5 Ave Anatole France, 75007 Paris",
          type: "Adventure",
        },
      ],
      culture: [
        {
          name: "Louvre Museum",
          address: "Rue de Rivoli, 75001 Paris",
          type: "Museum",
        },
        {
          name: "Musée d'Orsay",
          address: "1 Rue de la Légion d'Honneur, 75007 Paris",
          type: "Art Gallery",
        },
        {
          name: "Notre-Dame Cathedral",
          address: "6 Parvis Notre-Dame, 75004 Paris",
          type: "Historical Site",
        },
        {
          name: "Palace of Versailles",
          address: "Place d'Armes, 78000 Versailles",
          type: "Historical Site",
        },
      ],
      food: [
        {
          name: "Rue Cler Market Street",
          address: "Rue Cler, 75007 Paris",
          type: "Food Market",
        },
        {
          name: "French Cooking Class",
          address: "80 Quai de l'Hôtel de Ville, 75004 Paris",
          type: "Cooking Experience",
        },
        {
          name: "Le Marais Food Tour",
          address: "Le Marais, 75004 Paris",
          type: "Food Tour",
        },
        {
          name: "Montmartre Wine Tasting",
          address: "18 Rue Norvins, 75018 Paris",
          type: "Wine Experience",
        },
      ],
      relaxation: [
        { name: "Luxembourg Gardens", address: "75006 Paris", type: "Garden" },
        {
          name: "Le Spa by Clarins",
          address: "228 Rue de Rivoli, 75001 Paris",
          type: "Spa & Wellness",
        },
        {
          name: "Sacré-Cœur Basilica Viewpoint",
          address: "35 Rue du Chevalier de la Barre, 75018 Paris",
          type: "Scenic View",
        },
        {
          name: "Tuileries Garden Stroll",
          address: "Place de la Concorde, 75001 Paris",
          type: "Garden",
        },
      ],
      nature: [
        {
          name: "Jardin des Plantes",
          address: "57 Rue Cuvier, 75005 Paris",
          type: "Botanical Garden",
        },
        {
          name: "Bois de Boulogne",
          address: "Bois de Boulogne, 75016 Paris",
          type: "Park",
        },
        {
          name: "Parc des Buttes-Chaumont",
          address: "1 Rue Botzaris, 75019 Paris",
          type: "Park",
        },
        {
          name: "Giverny (Monet's Garden)",
          address: "84 Rue Claude Monet, 27620 Giverny",
          type: "Garden",
        },
      ],
      shopping: [
        {
          name: "Champs-Élysées Shopping",
          address: "Ave des Champs-Élysées, 75008 Paris",
          type: "Shopping Street",
        },
        {
          name: "Galeries Lafayette",
          address: "40 Blvd Haussmann, 75009 Paris",
          type: "Department Store",
        },
        {
          name: "Saint-Ouen Flea Market",
          address: "Marché aux Puces, 93400 Saint-Ouen",
          type: "Market",
        },
        {
          name: "Le Bon Marché",
          address: "24 Rue de Sèvres, 75007 Paris",
          type: "Department Store",
        },
      ],
      restaurants: [
        {
          name: "Le Bouillon Chartier",
          address: "7 Rue du Faubourg Montmartre, 75009 Paris",
          type: "French",
          price: "$",
        },
        {
          name: "L'Ambroisie",
          address: "9 Place des Vosges, 75004 Paris",
          type: "Fine Dining",
          price: "$$$$",
        },
        {
          name: "Café de Flore",
          address: "172 Blvd Saint-Germain, 75006 Paris",
          type: "Café",
          price: "$$",
        },
        {
          name: "Breizh Café",
          address: "109 Rue Vieille du Temple, 75003 Paris",
          type: "Crêperie",
          price: "$$",
        },
        {
          name: "Le Comptoir du Panthéon",
          address: "5 Rue Soufflot, 75005 Paris",
          type: "Bistro",
          price: "$$",
        },
        {
          name: "Pink Mamma",
          address: "20bis Rue de Douai, 75009 Paris",
          type: "Italian",
          price: "$$",
        },
        {
          name: "Chez Janou",
          address: "2 Rue Roger Verlomme, 75003 Paris",
          type: "Provençal",
          price: "$$-$$$",
        },
        {
          name: "Le Relais de l'Entrecôte",
          address: "20 Rue Marbeuf, 75008 Paris",
          type: "Steak",
          price: "$$$",
        },
        {
          name: "Ladurée",
          address: "75 Ave des Champs-Élysées, 75008 Paris",
          type: "Pâtisserie",
          price: "$$",
        },
        {
          name: "Bouillon Racine",
          address: "3 Rue Racine, 75006 Paris",
          type: "French",
          price: "$$",
        },
        {
          name: "Le Petit Cler",
          address: "29 Rue Cler, 75007 Paris",
          type: "Bistro",
          price: "$$",
        },
        {
          name: "Frenchie",
          address: "5 Rue du Nil, 75002 Paris",
          type: "Modern French",
          price: "$$$",
        },
        {
          name: "L'As du Fallafel",
          address: "34 Rue des Rosiers, 75004 Paris",
          type: "Middle Eastern",
          price: "$",
        },
        {
          name: "Chez L'Ami Jean",
          address: "27 Rue Malar, 75007 Paris",
          type: "Basque",
          price: "$$$",
        },
      ],
    },
    london: {
      adventure: [
        {
          name: "Tower of London Tour",
          address: "Tower Hill, London EC3N 4AB",
          type: "Historical Adventure",
        },
        {
          name: "Thames River Speedboat",
          address: "Westminster Pier, London SW1A 2JH",
          type: "Water Adventure",
        },
        {
          name: "Up at The O2 Climb",
          address: "Peninsula Square, London SE10 0DX",
          type: "Climbing",
        },
        {
          name: "London Eye Flight",
          address: "Riverside Building, County Hall, London SE1 7PB",
          type: "Scenic Experience",
        },
      ],
      culture: [
        {
          name: "British Museum",
          address: "Great Russell St, London WC1B 3DG",
          type: "Museum",
        },
        {
          name: "Buckingham Palace",
          address: "London SW1A 1AA",
          type: "Historical Site",
        },
        {
          name: "Tate Modern",
          address: "Bankside, London SE1 9TG",
          type: "Art Gallery",
        },
        {
          name: "West End Theatre Show",
          address: "Shaftesbury Ave, London W1D",
          type: "Cultural Venue",
        },
      ],
      food: [
        {
          name: "Borough Market",
          address: "8 Southwark St, London SE1 1TL",
          type: "Food Market",
        },
        {
          name: "Brick Lane Curry Tour",
          address: "Brick Lane, London E1",
          type: "Food Tour",
        },
        {
          name: "English Afternoon Tea",
          address: "The Ritz, 150 Piccadilly, London W1J 9BR",
          type: "Tea Experience",
        },
        {
          name: "Camden Market Food Stalls",
          address: "Camden Lock Place, London NW1 8AF",
          type: "Street Food",
        },
      ],
      relaxation: [
        { name: "Hyde Park", address: "London W2 2UH", type: "Park" },
        {
          name: "ESPA Life at Corinthia",
          address: "Whitehall Place, London SW1A 2BD",
          type: "Spa & Wellness",
        },
        {
          name: "The Shard View",
          address: "32 London Bridge St, London SE1 9SG",
          type: "Scenic View",
        },
        {
          name: "Kensington Palace Gardens",
          address: "Kensington Gardens, London W8 4PX",
          type: "Garden",
        },
      ],
      nature: [
        {
          name: "Regent's Park & Zoo",
          address: "Chester Rd, London NW1 4NR",
          type: "Park",
        },
        {
          name: "Kew Gardens",
          address: "Richmond TW9 3AE",
          type: "Botanical Garden",
        },
        {
          name: "Richmond Park Deer Walk",
          address: "Richmond TW10 5HS",
          type: "Nature Reserve",
        },
        { name: "Hampstead Heath", address: "London NW3 1TH", type: "Heath" },
      ],
      shopping: [
        {
          name: "Oxford Street Shopping",
          address: "Oxford St, London W1",
          type: "Shopping Street",
        },
        {
          name: "Harrods",
          address: "87-135 Brompton Rd, London SW1X 7XL",
          type: "Department Store",
        },
        {
          name: "Portobello Road Market",
          address: "Portobello Rd, London W11",
          type: "Market",
        },
        {
          name: "Covent Garden",
          address: "Covent Garden, London WC2E",
          type: "Shopping District",
        },
      ],
      restaurants: [
        {
          name: "Dishoom",
          address: "12 Upper St Martin's Ln, London WC2H 9FB",
          type: "Indian",
          price: "$$",
        },
        {
          name: "Flat Iron Steak",
          address: "17 Beak St, London W1F 9RW",
          type: "Steak",
          price: "$$",
        },
        {
          name: "Padella Pasta",
          address: "6 Southwark St, London SE1 1TQ",
          type: "Italian",
          price: "$$",
        },
        {
          name: "The Ivy",
          address: "1-5 West St, London WC2H 9NQ",
          type: "British",
          price: "$$$",
        },
        {
          name: "Nando's",
          address: "Various locations",
          type: "Portuguese Chicken",
          price: "$",
        },
        {
          name: "Sketch",
          address: "9 Conduit St, London W1S 2XG",
          type: "Modern European",
          price: "$$$",
        },
        {
          name: "Hawksmoor",
          address: "5a Air St, London W1J 0AD",
          type: "Steak",
          price: "$$$",
        },
        {
          name: "Bao",
          address: "53 Lexington St, London W1F 9AS",
          type: "Taiwanese",
          price: "$$",
        },
        {
          name: "Fish & Chips at Poppies",
          address: "6-8 Hanbury St, London E1 6QR",
          type: "Fish & Chips",
          price: "$",
        },
        {
          name: "The Wolseley",
          address: "160 Piccadilly, London W1J 9EB",
          type: "European",
          price: "$$$",
        },
        {
          name: "Ottolenghi",
          address: "287 Upper St, London N1 2TZ",
          type: "Mediterranean",
          price: "$$-$$$",
        },
        {
          name: "Duck & Waffle",
          address: "110 Bishopsgate, London EC2N 4AY",
          type: "British",
          price: "$$$",
        },
      ],
    },
  };

  // ── Generic fallback for any city not in the database ──────────────────
  function getGenericData(dest) {
    return {
      adventure: [
        {
          name: `${dest} Walking Tour`,
          address: `City Center, ${dest}`,
          type: "Walking Tour",
        },
        {
          name: `${dest} Bike Adventure`,
          address: `Main Park, ${dest}`,
          type: "Outdoor Adventure",
        },
        {
          name: `${dest} River/Harbor Cruise`,
          address: `Waterfront, ${dest}`,
          type: "Scenic Cruise",
        },
        {
          name: `${dest} Panoramic Viewpoint`,
          address: `Observation Deck, ${dest}`,
          type: "Scenic View",
        },
      ],
      culture: [
        {
          name: `${dest} National Museum`,
          address: `Museum District, ${dest}`,
          type: "Museum",
        },
        {
          name: `${dest} Historic Old Town`,
          address: `Old Town Quarter, ${dest}`,
          type: "Historical Site",
        },
        {
          name: `${dest} Art Gallery`,
          address: `Arts District, ${dest}`,
          type: "Art Gallery",
        },
        {
          name: `${dest} Cultural Performance`,
          address: `Theater District, ${dest}`,
          type: "Cultural Venue",
        },
      ],
      food: [
        {
          name: `${dest} Central Market`,
          address: `Market Square, ${dest}`,
          type: "Food Market",
        },
        {
          name: `${dest} Cooking Class`,
          address: `Culinary District, ${dest}`,
          type: "Cooking Experience",
        },
        {
          name: `${dest} Food Walking Tour`,
          address: `Downtown, ${dest}`,
          type: "Food Tour",
        },
        {
          name: `${dest} Street Food District`,
          address: `Night Market Area, ${dest}`,
          type: "Street Food",
        },
      ],
      relaxation: [
        {
          name: `${dest} City Park`,
          address: `Central Park, ${dest}`,
          type: "Park",
        },
        {
          name: `${dest} Spa & Wellness`,
          address: `Wellness District, ${dest}`,
          type: "Spa & Wellness",
        },
        {
          name: `${dest} Scenic Overlook`,
          address: `Hilltop, ${dest}`,
          type: "Scenic View",
        },
        {
          name: `${dest} Botanical Garden`,
          address: `Garden District, ${dest}`,
          type: "Garden",
        },
      ],
      nature: [
        {
          name: `${dest} Main Park`,
          address: `City Park, ${dest}`,
          type: "Park",
        },
        {
          name: `${dest} Botanical Garden`,
          address: `Science District, ${dest}`,
          type: "Botanical Garden",
        },
        {
          name: `${dest} Waterfront Trail`,
          address: `Waterfront, ${dest}`,
          type: "Nature Walk",
        },
        {
          name: `${dest} Wildlife Sanctuary`,
          address: `Outskirts, ${dest}`,
          type: "Nature Reserve",
        },
      ],
      shopping: [
        {
          name: `${dest} Main Shopping Street`,
          address: `High Street, ${dest}`,
          type: "Shopping Street",
        },
        {
          name: `${dest} Local Artisan Market`,
          address: `Market Square, ${dest}`,
          type: "Market",
        },
        {
          name: `${dest} Mall & Department Stores`,
          address: `Shopping District, ${dest}`,
          type: "Shopping Center",
        },
        {
          name: `${dest} Souvenir District`,
          address: `Tourist Quarter, ${dest}`,
          type: "Shopping District",
        },
      ],
      restaurants: [
        {
          name: `${dest} Traditional Restaurant`,
          address: `Old Town, ${dest}`,
          type: "Local Cuisine",
          price: "$$",
        },
        {
          name: `${dest} Fine Dining`,
          address: `City Center, ${dest}`,
          type: "Fine Dining",
          price: "$$$",
        },
        {
          name: `${dest} Street Food Corner`,
          address: `Market Area, ${dest}`,
          type: "Street Food",
          price: "$",
        },
        {
          name: `${dest} Waterfront Café`,
          address: `Waterfront, ${dest}`,
          type: "Café",
          price: "$$",
        },
        {
          name: `${dest} International Kitchen`,
          address: `Downtown, ${dest}`,
          type: "International",
          price: "$$",
        },
        {
          name: `${dest} Rooftop Restaurant`,
          address: `Skyline District, ${dest}`,
          type: "Modern",
          price: "$$$",
        },
        {
          name: `${dest} Family Bistro`,
          address: `Residential Area, ${dest}`,
          type: "Bistro",
          price: "$$",
        },
        {
          name: `${dest} Night Market Eats`,
          address: `Night Market, ${dest}`,
          type: "Street Food",
          price: "$",
        },
        {
          name: `${dest} Fusion Kitchen`,
          address: `Arts Quarter, ${dest}`,
          type: "Fusion",
          price: "$$-$$$",
        },
        {
          name: `${dest} Bakery & Brunch`,
          address: `Café District, ${dest}`,
          type: "Bakery",
          price: "$",
        },
        {
          name: `${dest} Garden Restaurant`,
          address: `Park Side, ${dest}`,
          type: "Garden Dining",
          price: "$$",
        },
        {
          name: `${dest} Seafood Spot`,
          address: `Harbor, ${dest}`,
          type: "Seafood",
          price: "$$$",
        },
        {
          name: `${dest} Budget Eats`,
          address: `University Area, ${dest}`,
          type: "Casual",
          price: "$",
        },
        {
          name: `${dest} Wine & Dine`,
          address: `Wine District, ${dest}`,
          type: "Wine Bar",
          price: "$$$",
        },
      ],
    };
  }

  // Match city (case-insensitive)
  const cityKey = destination.toLowerCase().trim();
  const data = cityData[cityKey] || getGenericData(destination);
  const restaurantDatabase = data.restaurants;

  // Build activity database from the matched city
  const activityDatabase = {
    adventure: data.adventure,
    culture: data.culture,
    food: data.food,
    relaxation: data.relaxation,
    nature: data.nature,
    shopping: data.shopping,
  };

  // Normalize preferences: accept object {adventure: true} or array ["adventure"]
  const prefArray = Array.isArray(preferences)
    ? preferences
    : typeof preferences === "object" && preferences
      ? Object.entries(preferences)
          .filter(([, v]) => v)
          .map(([k]) => k)
      : [];
  const selectedPreferences =
    prefArray.length > 0 ? prefArray : ["culture", "food"];

  // Shuffle restaurant database for randomization
  const shuffledRestaurants = [...restaurantDatabase].sort(
    () => Math.random() - 0.5,
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
        (a) => !usedActivities.has(a.name) && a.name !== morningActivity.name,
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
      ", ",
    )} activities.`,
    daily_plans,
    recommended_hotels: [
      {
        name: `Grand ${destination} Hotel`,
        rating: 4.5,
        price_range: "$150-250/night",
        address: `City Center, ${destination}`,
        description: `Luxury hotel in the heart of ${destination} with excellent amenities and proximity to major attractions.`,
      },
      {
        name: `${destination} Budget Inn`,
        rating: 3.8,
        price_range: "$60-100/night",
        address: `Downtown ${destination}`,
        description: `Affordable and comfortable accommodation near public transport and local dining.`,
      },
      {
        name: `Boutique ${destination} Suites`,
        rating: 4.2,
        price_range: "$120-180/night",
        address: `${destination} Arts District`,
        description: `Charming boutique hotel with unique decor, rooftop views, and personalized service.`,
      },
    ],
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
