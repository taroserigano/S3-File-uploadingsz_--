"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import DayMapView from "./DayMapView";

const SavedTripsPage = () => {
  const router = useRouter();
  const [trips, setTrips] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTrip, setSelectedTrip] = useState(null);
  const [activeDay, setActiveDay] = useState(0);

  useEffect(() => {
    fetchSavedTrips();
  }, []);

  const fetchSavedTrips = async () => {
    try {
      const response = await fetch("/api/travel/planner/saved");
      if (!response.ok) {
        throw new Error("Failed to fetch saved trips");
      }
      const data = await response.json();
      setTrips(data.tripPlans || []);
    } catch (error) {
      console.error("Error fetching trips:", error);
      toast.error("Failed to load saved trips");
    } finally {
      setIsLoading(false);
    }
  };

  const handleDeleteTrip = async (tripId, e) => {
    e.stopPropagation(); // Prevent card click event

    if (!confirm("Are you sure you want to delete this trip?")) {
      return;
    }

    try {
      console.log("Attempting to delete trip with ID:", tripId);
      const response = await fetch(`/api/travel/planner/saved/${tripId}`, {
        method: "DELETE",
      });

      console.log("Delete response status:", response.status);

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Delete error:", errorData);
        throw new Error(errorData.error || "Failed to delete trip");
      }

      toast.success("Trip deleted successfully!");
      // Remove from local state
      setTrips(trips.filter((trip) => trip.id !== tripId));
    } catch (error) {
      console.error("Error deleting trip:", error);
      toast.error(error.message || "Failed to delete trip");
    }
  };

  const handleViewTrip = (trip) => {
    setSelectedTrip(trip);
    setActiveDay(0);
  };

  const handleBackToList = () => {
    setSelectedTrip(null);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Not set";
    return new Date(dateString).toLocaleDateString();
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-base-200 flex items-center justify-center">
        <span className="loading loading-spinner loading-lg"></span>
      </div>
    );
  }

  if (selectedTrip) {
    const itinerary = selectedTrip.itinerary || {};
    const dailyPlans = itinerary.daily_plans || [];
    const day = dailyPlans[activeDay] || null;

    // Build deduplicated activity list for the map (matches TravelPlanner logic)
    const mapActivities = (() => {
      if (!day) return [];
      const acts = [...(day.activities || [])];
      if (day.meals) {
        const existingNames = new Set(
          acts.map((a) => (a.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""))
        );
        ["breakfast", "lunch", "dinner"].forEach((m) => {
          const meal = day.meals[m];
          if (!meal) return;
          const mealName = typeof meal === "string" ? meal : meal.name;
          const address = typeof meal === "string" ? null : meal.address;
          if (!mealName) return;
          const key = mealName.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (existingNames.has(key)) return;
          acts.push({
            name: mealName,
            time: m === "breakfast" ? "8:00 AM" : m === "lunch" ? "12:30 PM" : "7:00 PM",
            location: { name: mealName, address: address || mealName },
          });
        });
      }
      return acts;
    })();

    // Cost data
    const costs =
      itinerary.research?.estimated_costs || itinerary.estimated_costs;

    // Hotels — support both AI structure and Amadeus structure
    const hotels = Array.isArray(selectedTrip.hotels) ? selectedTrip.hotels : [];

    return (
      <div className="min-h-screen bg-base-200">
        {/* Header */}
        <div className="bg-base-100 shadow-lg">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
            <button onClick={handleBackToList} className="btn btn-ghost mb-4">
              ← Back to Saved Trips
            </button>
            <h1 className="text-4xl font-bold">{selectedTrip.title}</h1>
            <p className="text-base-content/70 mt-2">
              <span className="capitalize">{selectedTrip.destination}</span> •{" "}
              {selectedTrip.days} {selectedTrip.days === 1 ? "day" : "days"}
            </p>
          </div>
        </div>

        {/* Day tabs */}
        {dailyPlans.length > 0 && (
          <div className="sticky top-0 z-30 bg-base-100 border-b border-base-200 shadow-sm">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 py-2 flex gap-1 overflow-x-auto scrollbar-none">
              {dailyPlans.map((d, i) => (
                <button
                  key={i}
                  onClick={() => setActiveDay(i)}
                  className={`btn btn-xs flex-shrink-0 transition-all ${
                    activeDay === i ? "btn-primary" : "btn-ghost text-base-content/60"
                  }`}
                >
                  Day {d.day}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
          {/* Hero Image */}
          {itinerary.hero_image && (
            <div className="relative w-full h-80 rounded-lg overflow-hidden shadow-xl">
              <img
                src={itinerary.hero_image.regular}
                alt={itinerary.hero_image.alt_description || `${selectedTrip.destination} travel`}
                className="w-full h-full object-cover"
              />
              {itinerary.hero_image.photographer && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 to-transparent p-4">
                  <p className="text-white text-sm">
                    Photo by{" "}
                    <a
                      href={`${itinerary.hero_image.photographer_url}?utm_source=travel_planner&utm_medium=referral`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-primary-content"
                    >
                      {itinerary.hero_image.photographer}
                    </a>
                    {" on "}
                    <a
                      href="https://unsplash.com?utm_source=travel_planner&utm_medium=referral"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline hover:text-primary-content"
                    >
                      Unsplash
                    </a>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Trip overview */}
          {(itinerary.title || itinerary.description) && (
            <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-5">
              {itinerary.title && <h3 className="text-2xl font-bold mb-2">{itinerary.title}</h3>}
              {itinerary.description && (
                <p className="text-base-content/70">{itinerary.description}</p>
              )}
            </div>
          )}

          {/* Active day activities */}
          {day && (
            <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-5 sm:p-7 space-y-4">
              <div>
                <h3 className="text-xl font-bold">
                  Day {day.day}: {day.title}
                </h3>
                {day.theme && (
                  <p className="text-base-content/60 text-sm mt-1">{day.theme}</p>
                )}
              </div>

              <div className="space-y-4">
                {(day.activities || []).map((activity, actIdx) => (
                  <div key={actIdx} className="border-l-4 border-primary pl-4">
                    <p className="font-semibold text-primary text-sm">{activity.time}</p>
                    <h4 className="text-base font-bold mt-0.5">{activity.name}</h4>
                    {activity.description && (
                      <p className="text-sm text-base-content/70 mt-1">{activity.description}</p>
                    )}
                    {activity.location && (
                      <div className="mt-2 p-2 bg-base-200 rounded-lg flex items-start gap-2">
                        <span>📍</span>
                        <p className="text-sm font-medium">
                          {activity.location.address || activity.location.name}
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Day map */}
              {mapActivities.length > 0 && (
                <div className="mt-4 rounded-xl overflow-hidden border border-base-300 shadow">
                  <div className="bg-base-200 px-4 py-2 flex items-center gap-2 border-b border-base-300">
                    <span>🗺️</span>
                    <span className="text-sm font-semibold">Day {day.day} Route Map</span>
                    <span className="ml-auto badge badge-ghost badge-sm">
                      {mapActivities.length} stops
                    </span>
                  </div>
                  <DayMapView
                    activities={mapActivities}
                    city={itinerary.city || selectedTrip.destination}
                    dayNumber={day.day || activeDay + 1}
                  />
                </div>
              )}

              {/* Dining guide */}
              {day.meals && (
                <div className="card bg-base-100 border border-base-200 shadow-sm">
                  <div className="card-body p-4">
                    <h4 className="font-bold text-base flex items-center gap-2 mb-3">
                      🍽️ Dining Guide
                    </h4>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      {["breakfast", "lunch", "dinner"].map((mealType) => {
                        const meal = day.meals[mealType];
                        if (!meal) return null;
                        const mealName = typeof meal === "string" ? meal : meal.name;
                        const addr = typeof meal === "string" ? null : meal.address;
                        const cuisine = typeof meal === "object" ? meal.cuisine : null;
                        const price = typeof meal === "object" ? meal.price_range : null;
                        const icons = { breakfast: "🌅", lunch: "☀️", dinner: "🌙" };
                        return (
                          <div key={mealType} className="bg-base-200 rounded-lg p-3">
                            <div className="flex items-center gap-1.5 mb-1">
                              <span>{icons[mealType]}</span>
                              <span className="text-xs font-bold uppercase tracking-wide text-base-content/50">
                                {mealType}
                              </span>
                            </div>
                            <p className="font-semibold text-sm leading-snug">{mealName}</p>
                            {addr && (
                              <p className="text-xs text-base-content/50 mt-0.5 leading-snug">{addr}</p>
                            )}
                            {(cuisine || price) && (
                              <p className="text-xs text-primary mt-1">
                                {cuisine}
                                {cuisine && price ? " · " : ""}
                                {price}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* Day tip */}
              {day.tips && (
                <div className="alert alert-info text-sm py-2 px-4">
                  <span>💡</span>
                  <span>{day.tips}</span>
                </div>
              )}
            </div>
          )}

          {/* Cost summary */}
          {costs && Object.keys(costs).length > 0 && (
            <div className="card bg-base-100 border border-base-200 shadow-sm">
              <div className="card-body p-5">
                <h4 className="font-bold text-base mb-3 flex items-center gap-2">
                  💰 Estimated Costs
                </h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: "Accommodation", icon: "🏨", key: "accommodation" },
                    { label: "Food", icon: "🍜", key: "food" },
                    { label: "Activities", icon: "🎭", key: "activities" },
                    { label: "Transport", icon: "🚌", key: "transport" },
                  ].map(
                    ({ label, icon, key }) =>
                      costs[key] != null && (
                        <div key={key} className="bg-base-200 rounded-lg p-3 text-center">
                          <div className="text-xl mb-1">{icon}</div>
                          <div className="font-bold text-primary text-sm">${costs[key]}</div>
                          <div className="text-xs text-base-content/50">{label}</div>
                        </div>
                      )
                  )}
                </div>
                {costs.total != null && (
                  <div className="mt-3 pt-3 border-t border-base-300 flex justify-between items-center">
                    <span className="font-bold">Total Estimate</span>
                    <span className="text-xl font-extrabold text-primary">${costs.total}</span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Top 10 highlights */}
          {itinerary.top_10_places?.length > 0 && (
            <div className="card bg-base-100 border border-base-200 shadow-sm">
              <div className="card-body p-5">
                <h4 className="font-bold text-base mb-3">🏆 Top 10 Highlights</h4>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {itinerary.top_10_places.map((place, i) => (
                    <div key={i} className="flex items-center gap-2 text-sm">
                      <span className="w-6 h-6 rounded-full bg-primary text-primary-content flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {i + 1}
                      </span>
                      <span className="text-base-content/80">{place}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Local tips */}
          {itinerary.research?.local_tips?.length > 0 && (
            <div className="card bg-base-100 border border-base-200 shadow-sm">
              <div className="card-body p-5">
                <h4 className="font-bold text-base mb-3">💡 Local Tips</h4>
                <ul className="space-y-2">
                  {itinerary.research.local_tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-base-content/70">
                      <span className="text-primary mt-0.5">→</span>
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}

          {/* Hotels */}
          {hotels.length > 0 && (
            <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-5 sm:p-7">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                🏨 Recommended Hotels
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {hotels.slice(0, 6).map((hotel, idx) => (
                  <div
                    key={idx}
                    className="card bg-base-100 border border-base-200 shadow hover:shadow-lg transition-all hover:-translate-y-0.5"
                  >
                    <div className="card-body p-5">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h4 className="font-bold text-base leading-snug flex-1">{hotel.name}</h4>
                        {hotel.rating != null && (
                          <div className="flex items-center gap-1 bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 text-xs font-bold flex-shrink-0">
                            ⭐ {hotel.rating}
                          </div>
                        )}
                      </div>

                      {/* Price — AI structure */}
                      {hotel.price_range && (
                        <>
                          <div className="text-2xl font-extrabold text-primary leading-none">
                            {hotel.price_range}
                          </div>
                          <div className="text-xs text-base-content/40 mb-3">per night</div>
                        </>
                      )}
                      {/* Price — Amadeus structure fallback */}
                      {!hotel.price_range && hotel.price?.total && (
                        <>
                          <div className="text-2xl font-extrabold text-primary leading-none">
                            {hotel.price.currency} {hotel.price.total}
                          </div>
                          <div className="text-xs text-base-content/40 mb-3">per night</div>
                        </>
                      )}

                      {/* Address — handle both string and object */}
                      {hotel.address && (
                        <div className="flex gap-1.5 text-sm text-base-content/60 mb-3">
                          <span className="flex-shrink-0">📍</span>
                          <span className="line-clamp-2 leading-snug">
                            {typeof hotel.address === "string"
                              ? hotel.address
                              : hotel.address.lines?.join(", ")}
                          </span>
                        </div>
                      )}

                      {hotel.description && (
                        <p className="text-xs text-base-content/60 line-clamp-3 leading-relaxed">
                          {hotel.description}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-base-200">
      {/* Header */}
      <div className="bg-base-100 shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-4xl font-bold">Saved Trip Plans</h1>
          <p className="text-base-content/70 mt-2">
            View and manage your saved travel itineraries
          </p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {trips.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-6xl mb-4">✈️</div>
            <h2 className="text-2xl font-bold mb-2">No saved trips yet</h2>
            <p className="text-base-content/70 mb-6">
              Create your first trip plan to get started!
            </p>
            <button
              onClick={() => router.push("/planner")}
              className="btn btn-primary"
            >
              Create New Trip
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {trips.map((trip) => (
              <div
                key={trip.id}
                className="card bg-base-100 shadow-xl hover:shadow-2xl transition-shadow cursor-pointer overflow-hidden"
                onClick={() => handleViewTrip(trip)}
              >
                {/* Thumbnail Image */}
                {trip.itinerary?.hero_image && (
                  <figure className="h-48 overflow-hidden">
                    <img
                      src={trip.itinerary.hero_image.small}
                      alt={
                        trip.itinerary.hero_image.alt_description || trip.title
                      }
                      className="w-full h-full object-cover hover:scale-105 transition-transform duration-300"
                    />
                  </figure>
                )}

                <div className="card-body">
                  <h2 className="card-title">{trip.title}</h2>
                  <div className="space-y-2 text-sm">
                    <p className="flex items-center gap-2">
                      <span>📍</span>
                      <span className="capitalize">{trip.destination}</span>
                    </p>
                    <p className="flex items-center gap-2">
                      <span>📅</span>
                      <span>
                        {trip.days} {trip.days === 1 ? "day" : "days"}
                      </span>
                    </p>
                    {trip.checkIn && trip.checkOut && (
                      <p className="flex items-center gap-2">
                        <span>🗓️</span>
                        <span>
                          {formatDate(trip.checkIn)} -{" "}
                          {formatDate(trip.checkOut)}
                        </span>
                      </p>
                    )}
                    {trip.budget && (
                      <p className="flex items-center gap-2">
                        <span>💰</span>
                        <span>{trip.budget}</span>
                      </p>
                    )}
                  </div>
                  <div className="text-xs text-base-content/60 mt-3">
                    Saved on {new Date(trip.createdAt).toLocaleDateString()}
                  </div>
                  <div className="card-actions justify-between mt-4">
                    <button
                      onClick={(e) => handleDeleteTrip(trip.id, e)}
                      className="btn btn-error btn-sm btn-outline"
                    >
                      🗑️ Delete
                    </button>
                    <button className="btn btn-primary btn-sm">
                      View Details →
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SavedTripsPage;
