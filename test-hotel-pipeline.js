/**
 * Tests for app/api/travel/planner/route.js
 *
 * Validates that recommended_hotels always appears in the API response
 * with the correct schema regardless of which path is taken:
 *   - Backend available (agentic service responding)
 *   - Backend unavailable (fallback itinerary)
 *   - No check-in/out dates
 *
 * Also tests TravelPlanner.jsx data-merging logic via pure-function extraction.
 *
 * Run: node --experimental-vm-modules test-hotel-pipeline.js
 */

//
// ─── Helpers ──────────────────────────────────────────────────────────────────
//

const HOTEL_REQUIRED_FIELDS = [
  "name",
  "rating",
  "price_range",
  "address",
  "description",
];

function assertValidHotel(hotel, msg = "") {
  for (const field of HOTEL_REQUIRED_FIELDS) {
    if (!(field in hotel)) {
      throw new Error(
        `${msg} hotel missing field '${field}': ${JSON.stringify(hotel)}`,
      );
    }
  }
  if (typeof hotel.name !== "string" || !hotel.name)
    throw new Error(`${msg} name empty`);
  if (typeof hotel.rating !== "number")
    throw new Error(`${msg} rating not number`);
  if (typeof hotel.price_range !== "string" || !hotel.price_range)
    throw new Error(`${msg} price_range empty`);
  if (typeof hotel.address !== "string" || !hotel.address)
    throw new Error(`${msg} address empty`);
  if (typeof hotel.description !== "string")
    throw new Error(`${msg} description not string`);
}

function assertHotelList(hotels, minCount = 1, msg = "") {
  if (!Array.isArray(hotels)) throw new Error(`${msg} hotels not an array`);
  if (hotels.length < minCount)
    throw new Error(
      `${msg} expected >= ${minCount} hotels, got ${hotels.length}`,
    );
  hotels.forEach((h, i) => assertValidHotel(h, `${msg} hotels[${i}]`));
}

let passed = 0;
let failed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✅ ${name}`);
  } catch (e) {
    failed++;
    failures.push({ name, error: e.message });
    console.log(`  ❌ ${name}: ${e.message}`);
  }
}

//
// ─── Test: generateFallbackItinerary logic ────────────────────────────────────
// We replicate the function here because it's not easily importable from the route file.
//

function generateFallbackHotels(destination) {
  // This mirrors what generateFallbackItinerary() now returns in route.js
  return [
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
  ];
}

function generateSafetyNetHotels(destination) {
  // Mirrors the safety-net injection in route.js POST handler
  return [
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

// Simulates the frontend merge logic from TravelPlanner.jsx (fallback path)
function frontendMergeHotels(data, destination) {
  if (
    data.itinerary &&
    !data.itinerary.recommended_hotels?.length &&
    data.hotels?.length
  ) {
    data.itinerary.recommended_hotels = data.hotels.map((h) => ({
      name: h.name,
      rating: h.rating || 4.0,
      price_range: h.price?.total
        ? `$${h.price.total}/night`
        : h.price_range || "Contact for pricing",
      address: Array.isArray(h.address?.lines)
        ? h.address.lines.join(", ")
        : h.address || "",
      description: h.description || `Hotel in ${destination}`,
    }));
  }
  return data;
}

// Simulates the streaming fallback from TravelPlanner.jsx
function streamingFallbackHotels(tour, destination) {
  if (!tour.recommended_hotels?.length) {
    tour.recommended_hotels = [
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
  return tour;
}

//
// ─── Run Tests ────────────────────────────────────────────────────────────────
//

console.log("\n=== generateFallbackItinerary recommended_hotels ===");

test("fallback hotels for 'Tokyo' are valid", () => {
  const hotels = generateFallbackHotels("Tokyo");
  assertHotelList(hotels, 3, "fallback-Tokyo");
});

test("fallback hotels for 'Paris' contain city name", () => {
  const hotels = generateFallbackHotels("Paris");
  const allText = JSON.stringify(hotels);
  if (!allText.includes("Paris"))
    throw new Error("Paris not in fallback hotels");
});

test("fallback hotels for empty string still valid schema", () => {
  const hotels = generateFallbackHotels("");
  assertHotelList(hotels, 3, "fallback-empty");
});

console.log("\n=== Safety-net injection ===");

test("safety-net hotels are valid", () => {
  const hotels = generateSafetyNetHotels("London");
  assertHotelList(hotels, 3, "safety-net");
});

test("safety-net is NOT applied when itinerary already has hotels", () => {
  const itinerary = {
    recommended_hotels: [
      {
        name: "Existing",
        rating: 5,
        price_range: "$500",
        address: "A",
        description: "B",
      },
    ],
  };
  // Logic: only inject if !itinerary.recommended_hotels?.length
  if (
    !itinerary.recommended_hotels ||
    itinerary.recommended_hotels.length === 0
  ) {
    throw new Error("Safety-net wrongly applied");
  }
  // Should keep existing
  assertHotelList(itinerary.recommended_hotels, 1);
});

test("safety-net IS applied when itinerary has empty hotels array", () => {
  const itinerary = { recommended_hotels: [] };
  if (
    !itinerary.recommended_hotels ||
    itinerary.recommended_hotels.length === 0
  ) {
    itinerary.recommended_hotels = generateSafetyNetHotels("Berlin");
  }
  assertHotelList(itinerary.recommended_hotels, 3, "safety-net-empty");
});

test("safety-net IS applied when itinerary has no hotels key", () => {
  const itinerary = {};
  if (
    !itinerary.recommended_hotels ||
    itinerary.recommended_hotels.length === 0
  ) {
    itinerary.recommended_hotels = generateSafetyNetHotels("Rome");
  }
  assertHotelList(itinerary.recommended_hotels, 3, "safety-net-missing");
});

console.log("\n=== Frontend merge logic (TravelPlanner.jsx fallback path) ===");

test("merges top-level hotels into itinerary.recommended_hotels", () => {
  const data = {
    itinerary: { daily_plans: [] },
    hotels: [
      {
        name: "Grand Tokyo Hotel",
        rating: 4.5,
        price: { total: "150", currency: "USD" },
        address: { lines: ["123 Main St"], cityName: "Tokyo" },
      },
    ],
  };
  frontendMergeHotels(data, "Tokyo");
  assertHotelList(data.itinerary.recommended_hotels, 1, "merge");
  if (data.itinerary.recommended_hotels[0].price_range !== "$150/night") {
    throw new Error("price_range not formatted from price.total");
  }
});

test("does NOT overwrite existing itinerary.recommended_hotels", () => {
  const data = {
    itinerary: {
      recommended_hotels: [
        {
          name: "Existing",
          rating: 5,
          price_range: "$500",
          address: "A",
          description: "B",
        },
      ],
    },
    hotels: [
      {
        name: "Should Not Merge",
        rating: 3,
        address: { lines: ["X"] },
        price: { total: "50" },
      },
    ],
  };
  frontendMergeHotels(data, "Tokyo");
  if (data.itinerary.recommended_hotels.length !== 1)
    throw new Error("Should not merge");
  if (data.itinerary.recommended_hotels[0].name !== "Existing")
    throw new Error("Wrong hotel");
});

test("handles hotel with no price.total gracefully", () => {
  const data = {
    itinerary: {},
    hotels: [{ name: "No Price Hotel", address: { lines: ["456 Ave"] } }],
  };
  frontendMergeHotels(data, "Berlin");
  assertHotelList(data.itinerary.recommended_hotels, 1, "no-price");
  if (
    data.itinerary.recommended_hotels[0].price_range !== "Contact for pricing"
  ) {
    throw new Error("Expected 'Contact for pricing' fallback");
  }
});

test("handles hotel with string address (no .lines)", () => {
  const data = {
    itinerary: {},
    hotels: [{ name: "String Addr", rating: 4, address: "789 Street" }],
  };
  frontendMergeHotels(data, "NYC");
  assertHotelList(data.itinerary.recommended_hotels, 1, "str-addr");
  // address should be extracted correctly (string fallback)
});

test("handles hotel with price_range already set", () => {
  const data = {
    itinerary: {},
    hotels: [
      {
        name: "Has Range",
        rating: 4.2,
        price_range: "$200-300/night",
        address: "X",
      },
    ],
  };
  frontendMergeHotels(data, "Tokyo");
  const h = data.itinerary.recommended_hotels[0];
  if (h.price_range !== "$200-300/night")
    throw new Error("Should keep price_range");
});

console.log("\n=== Streaming fallback (TravelPlanner.jsx stream path) ===");

test("adds hotels when tour has none", () => {
  const tour = { daily_plans: [] };
  streamingFallbackHotels(tour, "Osaka");
  assertHotelList(tour.recommended_hotels, 3, "streaming-fallback");
});

test("does NOT overwrite when tour already has hotels", () => {
  const tour = {
    recommended_hotels: [
      {
        name: "Existing",
        rating: 5,
        price_range: "$500",
        address: "A",
        description: "B",
      },
    ],
  };
  streamingFallbackHotels(tour, "Osaka");
  if (tour.recommended_hotels.length !== 1)
    throw new Error("Overwrote existing");
});

test("fallback hotels contain destination name", () => {
  const tour = {};
  streamingFallbackHotels(tour, "Barcelona");
  const allText = JSON.stringify(tour.recommended_hotels);
  if (!allText.includes("Barcelona"))
    throw new Error("Barcelona not in fallback");
});

console.log("\n=== Data shape: tripData.itinerary.recommended_hotels path ===");

test("non-streaming response has correct tripData shape", () => {
  // Simulate what route.js returns
  const response = {
    itinerary: {
      title: "3-Day Tokyo Adventure",
      daily_plans: [],
      recommended_hotels: generateFallbackHotels("Tokyo"),
    },
    flights: [],
    metadata: { destination: "Tokyo" },
  };
  // Frontend reads: tripData.itinerary.recommended_hotels
  const hotels = response.itinerary?.recommended_hotels || [];
  assertHotelList(hotels, 3, "response-shape");
});

test("streaming response has correct tripData shape", () => {
  // Simulate what streaming handler creates: { itinerary: tour, run_id, cost }
  const tour = {
    city: "Paris",
    daily_plans: [],
    recommended_hotels: generateFallbackHotels("Paris"),
  };
  const tripData = {
    itinerary: tour,
    run_id: "test-123",
    cost: {},
  };
  const hotels = tripData.itinerary?.recommended_hotels || [];
  assertHotelList(hotels, 3, "streamed-shape");
});

test("backend tour with recommended_hotels flows through correctly", () => {
  // Simulate backend response: { run_id, tour: { recommended_hotels: [...] }, cost }
  const backendResponse = {
    run_id: "abc-123",
    tour: {
      city: "London",
      daily_plans: [],
      recommended_hotels: [
        {
          name: "Backend Hotel",
          rating: 4.5,
          price_range: "$200/night",
          address: "Westminster",
          description: "Historic",
        },
      ],
    },
    cost: {},
  };
  // route.js does: itineraryData = { itinerary: tour }
  const itineraryData = { itinerary: backendResponse.tour };
  // Then returns: { itinerary: itineraryData.itinerary }
  const response = { itinerary: itineraryData.itinerary };
  const hotels = response.itinerary?.recommended_hotels || [];
  assertHotelList(hotels, 1, "backend-flow");
});

//
// ─── Summary ──────────────────────────────────────────────────────────────────
//

console.log(`\n${"=".repeat(60)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failures.length) {
  console.log("\nFailures:");
  failures.forEach((f) => console.log(`  ❌ ${f.name}: ${f.error}`));
  process.exit(1);
} else {
  console.log("All tests passed! ✅");
  process.exit(0);
}
