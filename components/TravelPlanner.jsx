"use client";

import { useState, useRef } from "react";
import toast from "react-hot-toast";
import DayMapView from "./DayMapView";

// ── Preference config with emojis ─────────────────────────────────────────
const PREFS = [
  { key: "adventure", label: "Adventure", icon: "🧗" },
  { key: "relaxation", label: "Relaxation", icon: "🧘" },
  { key: "culture", label: "Culture", icon: "🏛️" },
  { key: "food", label: "Food", icon: "🍜" },
  { key: "nature", label: "Nature", icon: "🌿" },
  { key: "shopping", label: "Shopping", icon: "🛍️" },
];

// ── Streaming phase labels ────────────────────────────────────────────────
const PHASE_LABEL = {
  connecting: "Connecting to AI…",
  starting: "Starting planner…",
  generating_itinerary: "Building your itinerary…",
  fetching_travel_data: "Fetching flights & hotels…",
  cache_hit: "Loading saved plan…",
  complete: "Done!",
};
const PHASE_STEPS = [
  "connecting",
  "starting",
  "generating_itinerary",
  "fetching_travel_data",
  "complete",
];

// ── Activity type → icon ─────────────────────────────────────────────────
function activityIcon(name = "", time = "") {
  const n = name.toLowerCase();
  const t = time.toLowerCase();
  if (n.includes("breakfast") || t === "7:00 am") return "🍳";
  if (n.includes("lunch") || t === "12:00 pm") return "🍱";
  if (n.includes("dinner") || t === "6:30 pm") return "🍽️";
  if (
    n.includes("museum") ||
    n.includes("palace") ||
    n.includes("temple") ||
    n.includes("shrine")
  )
    return "🏛️";
  if (
    n.includes("park") ||
    n.includes("garden") ||
    n.includes("nature") ||
    n.includes("hik")
  )
    return "🌳";
  if (n.includes("shop") || n.includes("market") || n.includes("mall"))
    return "🛍️";
  if (n.includes("beach") || n.includes("sea") || n.includes("ocean"))
    return "🏖️";
  if (n.includes("evening") || time.includes("8:00 pm")) return "🌆";
  if (n.includes("tour") || n.includes("walk")) return "🚶";
  return "📍";
}

const TravelPlanner = ({ userId }) => {
  // Form state
  const [destination, setDestination] = useState("");
  const [country, setCountry] = useState("");
  const [days, setDays] = useState(2);
  const [budget, setBudget] = useState("");
  const [preferences, setPreferences] = useState({
    adventure: false,
    relaxation: false,
    culture: false,
    food: false,
    nature: false,
    shopping: false,
  });

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [tripData, setTripData] = useState(null);
  const [error, setError] = useState(null);
  const [isSaving, setIsSaving] = useState(false);

  // Streaming state
  const [streamPhase, setStreamPhase] = useState("");
  const [streamChunks, setStreamChunks] = useState("");
  const abortRef = useRef(null);

  // UI state
  const [activeDay, setActiveDay] = useState(0);

  const handlePreferenceToggle = (pref) => {
    setPreferences((prev) => ({
      ...prev,
      [pref]: !prev[pref],
    }));
  };

  // ---------------------------------------------------------------
  // SSE streaming trip generation
  // ---------------------------------------------------------------
  const handlePlanTrip = async (e) => {
    e.preventDefault();

    if (!destination.trim()) {
      toast.error("Please enter a destination");
      return;
    }
    if (days < 1 || days > 30) {
      toast.error("Trip duration must be between 1 and 30 days");
      return;
    }

    setIsLoading(true);
    setError(null);
    setStreamPhase("connecting");
    setStreamChunks("");
    setTripData(null);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Use SSE streaming endpoint for real-time progress
      const response = await fetch("/api/travel/planner/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          country,
          days,
          budget,
          preferences,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to generate trip plan");
      }

      // Parse SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let resultData = null;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (separated by double newline)
        const messages = buffer.split("\n\n");
        buffer = messages.pop(); // keep incomplete message in buffer

        for (const msg of messages) {
          if (!msg.trim()) continue;
          let eventType = "message";
          let dataStr = "";
          for (const line of msg.split("\n")) {
            if (line.startsWith("event: ")) eventType = line.slice(7).trim();
            else if (line.startsWith("data: ")) dataStr = line.slice(6);
          }
          if (!dataStr) continue;

          try {
            const payload = JSON.parse(dataStr);

            if (eventType === "status" && payload.phase) {
              setStreamPhase(payload.phase);
            } else if (eventType === "chunk" && payload.text) {
              setStreamChunks((prev) => prev + payload.text);
            } else if (eventType === "result") {
              resultData = payload;
            } else if (eventType === "error") {
              throw new Error(
                payload.error || "Backend error during generation",
              );
            }
            // "done" event — just let the loop finish
          } catch (parseErr) {
            // Ignore JSON parse errors for partial data
            if (parseErr.message && !parseErr.message.includes("JSON"))
              throw parseErr;
          }
        }
      }

      // Build the tripData from the SSE result
      if (!resultData || resultData.status === "failed") {
        // Fall back to non-streaming endpoint
        setStreamPhase("generating_itinerary");
        setStreamChunks("");
        const fallbackRes = await fetch("/api/travel/planner", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destination,
            country,
            days,
            budget,
            preferences,
          }),
        });
        if (!fallbackRes.ok) throw new Error("Failed to generate trip plan");
        resultData = await fallbackRes.json();
        setTripData(resultData);
      } else {
        // Transform backend result to match frontend shape
        const tour = resultData.tour || resultData;

        // Normalize daily_plans: map plan[]→activities[], activity→name, notes→description
        if (tour.daily_plans) {
          tour.daily_plans = tour.daily_plans.map((day) => ({
            ...day,
            title: day.theme || day.title,
            activities: (day.plan || day.activities || []).map((a) => ({
              time: a.time,
              name: a.activity || a.name,
              description: a.notes || a.description,
              location:
                typeof a.location === "string"
                  ? { address: a.location, type: "location" }
                  : a.location,
              duration: a.duration,
              estimated_cost: a.estimated_cost,
            })),
          }));
        } else if (tour.daily_schedule) {
          tour.daily_plans = tour.daily_schedule.map((day) => ({
            ...day,
            title: day.theme || day.title,
            activities: (day.activities || []).map((a) => ({
              time: a.time,
              name: a.activity || a.name,
              description: a.notes || a.description,
              location:
                typeof a.location === "string"
                  ? { address: a.location, type: "location" }
                  : a.location,
              duration: a.duration,
              estimated_cost: a.estimated_cost,
            })),
          }));
        }

        const data = {
          itinerary: tour,
          run_id: resultData.run_id,
          cost: resultData.cost,
        };
        // Ensure recommended_hotels lives inside itinerary
        if (
          data.itinerary &&
          !data.itinerary.recommended_hotels?.length &&
          resultData.hotels?.length
        ) {
          data.itinerary.recommended_hotels = resultData.hotels.map((h) => ({
            name: h.name,
            rating: h.rating || 4.0,
            price_range: h.price?.total
              ? `$${h.price.total}/night`
              : h.price_range || "$100-200/night",
            address: Array.isArray(h.address?.lines)
              ? h.address.lines.join(", ")
              : h.address || "",
            description: h.description || `Hotel in ${destination}`,
          }));
        }
        setTripData(data);
      }
      setStreamPhase("complete");
      toast.success("Trip plan generated!");
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Error generating trip:", err);
      setError(err.message || "Failed to generate trip plan");
      toast.error(err.message || "Failed to generate trip plan");
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  };

  const handleSaveTrip = async () => {
    if (!tripData) return;

    setIsSaving(true);
    try {
      const response = await fetch("/api/travel/planner/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          destination,
          country,
          days,
          budget,
          preferences,
          itinerary: tripData.itinerary,
          hotels: tripData.itinerary?.recommended_hotels || [],
          heroImage: tripData.itinerary?.hero_image?.regular || null,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save trip plan");
      }

      const data = await response.json();
      toast.success("Trip plan saved successfully! 🎉");
    } catch (err) {
      console.error("Error saving trip:", err);
      toast.error("Failed to save trip plan");
    } finally {
      setIsSaving(false);
    }
  };

  const renderItinerary = () => {
    if (!tripData?.itinerary) return null;
    const plans = tripData.itinerary.daily_plans || [];
    const day = plans[activeDay];
    if (!day) return null;

    // Build deduplicated activity list for map
    const mapActivities = (() => {
      const acts = [...(day.activities || [])];
      if (day.meals) {
        const existingNames = new Set(
          acts.map((a) =>
            (a.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
          ),
        );
        const existingLocNames = new Set(
          acts.map((a) =>
            (a.location?.name || "").toLowerCase().replace(/[^a-z0-9]/g, ""),
          ),
        );
        ["breakfast", "lunch", "dinner"].forEach((m) => {
          const meal = day.meals[m];
          if (!meal) return;
          const mealName = typeof meal === "string" ? meal : meal.name;
          const address = typeof meal === "string" ? null : meal.address;
          if (!mealName) return;
          const key = mealName.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (existingNames.has(key) || existingLocNames.has(key)) return;
          const isDuplicate = acts.some((a) => {
            const an = (a.name || "").toLowerCase();
            const ln = (a.location?.name || "").toLowerCase();
            const mn = mealName.toLowerCase();
            return (
              an.includes(mn) ||
              mn.includes(an) ||
              ln.includes(mn) ||
              mn.includes(ln)
            );
          });
          if (isDuplicate) return;
          acts.push({
            name: mealName,
            time:
              m === "breakfast"
                ? "8:00 AM"
                : m === "lunch"
                  ? "12:30 PM"
                  : "7:00 PM",
            location: address
              ? { name: mealName, address }
              : { name: mealName, address: mealName },
          });
        });
      }
      return acts;
    })();

    return (
      <div className="space-y-4">
        {/* Day header */}
        <div className="flex items-center gap-3 mb-2">
          <div className="badge badge-primary badge-lg text-base font-bold px-4 py-3">
            Day {day.day}
          </div>
          <div>
            <h3 className="text-xl font-bold leading-tight">
              {day.title || day.theme}
            </h3>
            {day.estimated_walking && (
              <p className="text-xs text-base-content/50 mt-0.5">
                🚶 {day.estimated_walking} walking
              </p>
            )}
          </div>
        </div>

        {/* Timeline activities */}
        <div className="relative">
          {/* Vertical line */}
          <div className="absolute left-6 top-4 bottom-4 w-0.5 bg-base-300" />

          <div className="space-y-3">
            {(day.activities || []).map((activity, actIdx) => (
              <div key={actIdx} className="relative flex gap-4">
                {/* Timeline dot */}
                <div className="relative z-10 flex-shrink-0 w-12 h-12 rounded-full bg-primary/10 border-2 border-primary flex items-center justify-center text-lg shadow-sm">
                  {activityIcon(activity.name, activity.time)}
                </div>

                {/* Card */}
                <div className="flex-1 card bg-base-100 border border-base-200 shadow-sm hover:shadow-md transition-shadow mb-1">
                  <div className="card-body p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="badge badge-outline badge-sm font-mono font-bold">
                            {activity.time}
                          </span>
                          {activity.duration && (
                            <span className="text-xs text-base-content/50">
                              ⏱ {activity.duration}
                            </span>
                          )}
                        </div>
                        <h4 className="font-bold text-base mt-1 leading-snug">
                          {activity.name}
                        </h4>
                        {activity.description && (
                          <p className="text-sm text-base-content/60 mt-1 line-clamp-2">
                            {activity.description}
                          </p>
                        )}
                      </div>
                    </div>

                    {activity.location &&
                      (activity.location.name || activity.location.address) && (
                        <div className="mt-2 flex items-start gap-1.5 bg-base-200 rounded-lg px-3 py-2">
                          <span className="text-sm mt-0.5">📍</span>
                          <div className="flex-1 min-w-0">
                            {activity.location.name && (
                              <p className="text-sm font-semibold truncate">
                                {activity.location.name}
                              </p>
                            )}
                            {activity.location.address &&
                              activity.location.address !==
                                activity.location.name && (
                                <p className="text-xs text-base-content/50 mt-0.5 leading-relaxed">
                                  {activity.location.address}
                                </p>
                              )}
                            {!activity.location.name &&
                              activity.location.address && (
                                <p className="text-sm font-semibold">
                                  {activity.location.address}
                                </p>
                              )}
                          </div>
                        </div>
                      )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Map */}
        {mapActivities.length > 0 && (
          <div className="mt-4 rounded-xl overflow-hidden border border-base-300 shadow">
            <div className="bg-base-200 px-4 py-2 flex items-center gap-2 border-b border-base-300">
              <span>🗺️</span>
              <span className="text-sm font-semibold">
                Day {day.day} Route Map
              </span>
              <span className="ml-auto badge badge-ghost badge-sm">
                {mapActivities.length} stops
              </span>
            </div>
            <DayMapView
              activities={mapActivities}
              city={
                tripData.metadata?.destination ||
                tripData.itinerary?.city ||
                destination
              }
              dayNumber={day.day || activeDay + 1}
            />
          </div>
        )}

        {/* Dining summary */}
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
                  const cuisine =
                    typeof meal === "object" ? meal.cuisine : null;
                  const price =
                    typeof meal === "object" ? meal.price_range : null;
                  const icons = { breakfast: "🌅", lunch: "☀️", dinner: "🌙" };
                  return (
                    <div key={mealType} className="bg-base-200 rounded-lg p-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <span>{icons[mealType]}</span>
                        <span className="text-xs font-bold uppercase tracking-wide text-base-content/50">
                          {mealType}
                        </span>
                      </div>
                      <p className="font-semibold text-sm leading-snug">
                        {mealName}
                      </p>
                      {addr && (
                        <p className="text-xs text-base-content/50 mt-0.5 leading-snug">
                          {addr}
                        </p>
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
    );
  };

  const renderRecommendedHotels = () => {
    const hotels = tripData?.itinerary?.recommended_hotels || [];

    if (!hotels.length)
      return (
        <p className="text-base-content/50 text-sm py-4 text-center">
          No hotel recommendations available
        </p>
      );

    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {hotels.map((hotel, idx) => (
          <div
            key={idx}
            className="card bg-base-100 border border-base-200 shadow hover:shadow-lg transition-all hover:-translate-y-0.5"
          >
            <div className="card-body p-5">
              {/* Star rating badge */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-base leading-snug flex-1">
                  {hotel.name}
                </h3>
                <div className="flex items-center gap-1 bg-amber-100 text-amber-700 rounded-full px-2 py-0.5 text-xs font-bold flex-shrink-0">
                  ⭐ {hotel.rating}
                </div>
              </div>

              <div className="text-2xl font-extrabold text-primary leading-none">
                {hotel.price_range}
              </div>
              <div className="text-xs text-base-content/40 mb-3">per night</div>

              {hotel.address && (
                <div className="flex gap-1.5 text-sm text-base-content/60 mb-3">
                  <span className="flex-shrink-0">📍</span>
                  <span className="line-clamp-2 leading-snug">
                    {hotel.address}
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
    );
  };

  // ── Streaming progress bar ──────────────────────────────────────────────
  const renderStreamingState = () => {
    const stepIndex = PHASE_STEPS.indexOf(streamPhase);
    return (
      <div className="mt-6 space-y-4">
        {/* Step indicators */}
        <div className="flex items-center gap-1 overflow-x-auto pb-2">
          {PHASE_STEPS.map((step, i) => {
            const past = stepIndex > i;
            const current = stepIndex === i;
            return (
              <div key={step} className="flex items-center gap-1 flex-shrink-0">
                <div
                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
                  ${past ? "bg-primary border-primary text-primary-content" : ""}
                  ${current ? "bg-primary/20 border-primary text-primary animate-pulse" : ""}
                  ${!past && !current ? "bg-base-200 border-base-300 text-base-content/30" : ""}
                `}
                >
                  {past ? "✓" : i + 1}
                </div>
                {i < PHASE_STEPS.length - 1 && (
                  <div
                    className={`h-0.5 w-8 transition-all ${past ? "bg-primary" : "bg-base-300"}`}
                  />
                )}
              </div>
            );
          })}
        </div>

        {/* Current phase label */}
        <div className="flex items-center gap-2 text-sm font-medium text-primary">
          <span className="loading loading-dots loading-xs" />
          {PHASE_LABEL[streamPhase] || "Working…"}
        </div>

        {/* JSON token preview */}
        {streamChunks && (
          <div className="bg-base-200 rounded-lg p-3 max-h-36 overflow-y-auto">
            <p className="text-xs text-base-content/40 font-mono leading-relaxed whitespace-pre-wrap break-all">
              {streamChunks.slice(-600)}
            </p>
          </div>
        )}
      </div>
    );
  };

  // ── Cost summary ─────────────────────────────────────────────────────────
  const renderCostSummary = () => {
    const costs =
      tripData?.itinerary?.research?.estimated_costs ||
      tripData?.itinerary?.estimated_costs;
    if (!costs || !Object.keys(costs).length) return null;
    const items = [
      { label: "Accommodation", icon: "🏨", key: "accommodation" },
      { label: "Food", icon: "🍜", key: "food" },
      { label: "Activities", icon: "🎭", key: "activities" },
      { label: "Transport", icon: "🚌", key: "transport" },
    ];
    return (
      <div className="card bg-base-100 border border-base-200 shadow-sm">
        <div className="card-body p-5">
          <h4 className="font-bold text-base mb-3 flex items-center gap-2">
            💰 Estimated Costs
          </h4>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {items.map(
              ({ label, icon, key }) =>
                costs[key] != null && (
                  <div
                    key={key}
                    className="bg-base-200 rounded-lg p-3 text-center"
                  >
                    <div className="text-xl mb-1">{icon}</div>
                    <div className="font-bold text-primary text-sm">
                      ${costs[key]}
                    </div>
                    <div className="text-xs text-base-content/50">{label}</div>
                  </div>
                ),
            )}
          </div>
          {costs.total != null && (
            <div className="mt-3 pt-3 border-t border-base-300 flex justify-between items-center">
              <span className="font-bold">Total Estimate</span>
              <span className="text-xl font-extrabold text-primary">
                ${costs.total}
              </span>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-base-200">
      {/* ── FORM ────────────────────────────────────────────────────────── */}
      {!tripData && (
        <>
          {/* Page header banner */}
          <div className="bg-gradient-to-br from-primary to-secondary text-primary-content">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 py-12 text-center">
              <div className="text-5xl mb-3">✈️</div>
              <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
                AI Travel Planner
              </h1>
              <p className="mt-3 text-primary-content/80 text-lg max-w-xl mx-auto">
                Describe your dream trip and let AI build a personalised
                day-by-day itinerary with maps, dining, and hotels.
              </p>
            </div>
          </div>

          <div className="max-w-3xl mx-auto px-4 sm:px-6 py-10">
            <div className="card bg-base-100 shadow-2xl">
              <div className="card-body p-6 sm:p-8">
                <h2 className="text-2xl font-bold mb-6">Plan Your Trip</h2>

                <form onSubmit={handlePlanTrip} className="space-y-6">
                  {/* Destination + Country */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div className="form-control">
                      <label className="label pb-1">
                        <span className="label-text font-semibold">
                          🌆 Destination City
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Tokyo"
                        className="input input-bordered focus:input-primary"
                        value={destination}
                        onChange={(e) => setDestination(e.target.value)}
                        required
                      />
                    </div>
                    <div className="form-control">
                      <label className="label pb-1">
                        <span className="label-text font-semibold">
                          🌏 Country{" "}
                          <span className="font-normal text-base-content/40">
                            (optional)
                          </span>
                        </span>
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. Japan"
                        className="input input-bordered focus:input-primary"
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                      />
                    </div>
                  </div>

                  {/* Days slider */}
                  <div className="form-control">
                    <label className="label pb-1">
                      <span className="label-text font-semibold">
                        📅 Duration
                      </span>
                      <span className="label-text-alt text-primary font-bold text-base">
                        {days} {days === 1 ? "day" : "days"}
                      </span>
                    </label>
                    <input
                      type="range"
                      min="1"
                      max="14"
                      className="range range-primary range-sm"
                      value={days}
                      onChange={(e) => setDays(parseInt(e.target.value))}
                    />
                    <div className="flex justify-between text-xs text-base-content/40 px-1 mt-1">
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14].map(
                        (d) => (
                          <span key={d}>{d}</span>
                        ),
                      )}
                    </div>
                  </div>

                  {/* Budget */}
                  <div className="form-control">
                    <label className="label pb-1">
                      <span className="label-text font-semibold">
                        💵 Budget{" "}
                        <span className="font-normal text-base-content/40">
                          (optional)
                        </span>
                      </span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g. $3000"
                      className="input input-bordered focus:input-primary"
                      value={budget}
                      onChange={(e) => setBudget(e.target.value)}
                    />
                  </div>

                  {/* Preferences */}
                  <div className="form-control">
                    <label className="label pb-2">
                      <span className="label-text font-semibold">
                        🎯 Travel Style
                      </span>
                      <span className="label-text-alt text-base-content/40">
                        pick any
                      </span>
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {PREFS.map(({ key, label, icon }) => (
                        <button
                          key={key}
                          type="button"
                          onClick={() => handlePreferenceToggle(key)}
                          className={`btn btn-sm gap-1.5 transition-all ${
                            preferences[key]
                              ? "btn-primary shadow-md"
                              : "btn-outline opacity-70 hover:opacity-100"
                          }`}
                        >
                          <span>{icon}</span> {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {error && (
                    <div className="alert alert-error text-sm py-2">
                      <span>⚠️ {error}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="btn btn-primary btn-lg w-full text-base"
                    disabled={isLoading}
                  >
                    {isLoading ? (
                      <>
                        <span className="loading loading-spinner loading-sm" />
                        {PHASE_LABEL[streamPhase] || "Generating…"}
                      </>
                    ) : (
                      <>✈️ Generate My Trip Plan</>
                    )}
                  </button>
                </form>

                {/* Streaming progress */}
                {isLoading && renderStreamingState()}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── RESULTS ─────────────────────────────────────────────────────── */}
      {tripData && (
        <div>
          {/* Hero image / title banner */}
          <div className="relative w-full h-72 sm:h-96 bg-neutral overflow-hidden">
            {tripData.itinerary?.hero_image ? (
              <img
                src={tripData.itinerary.hero_image.regular}
                alt={
                  tripData.itinerary.hero_image.alt_description || destination
                }
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-primary to-secondary" />
            )}
            {/* Dark overlay */}
            <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-transparent" />
            {/* Title text */}
            <div className="absolute bottom-0 left-0 p-6 sm:p-10">
              <h1 className="text-white text-4xl sm:text-6xl font-extrabold tracking-tight drop-shadow-2xl uppercase">
                {tripData.metadata?.destination || tripData.itinerary?.city}
              </h1>
              {tripData.metadata?.country && (
                <p className="text-white/70 text-lg mt-1">
                  {tripData.metadata.country}
                </p>
              )}
              <div className="flex flex-wrap gap-3 mt-3">
                <span className="badge badge-primary badge-lg gap-1">
                  📅 {days} days
                </span>
                {budget && (
                  <span className="badge badge-secondary badge-lg gap-1">
                    💵 {budget}
                  </span>
                )}
                {Object.keys(preferences)
                  .filter((k) => preferences[k])
                  .map((k) => {
                    const p = PREFS.find((p) => p.key === k);
                    return (
                      <span
                        key={k}
                        className="badge badge-ghost badge-lg text-white border-white/30"
                      >
                        {p?.icon} {p?.label}
                      </span>
                    );
                  })}
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="sticky top-0 z-30 bg-base-100 border-b border-base-200 shadow-sm">
            <div className="max-w-6xl mx-auto px-4 sm:px-6">
              <div className="flex items-center justify-between py-3 gap-4">
                <p className="text-sm text-base-content/60 line-clamp-1 flex-1">
                  {tripData.itinerary?.description}
                </p>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    onClick={handleSaveTrip}
                    disabled={isSaving}
                    className="btn btn-primary btn-sm gap-1"
                  >
                    {isSaving ? (
                      <>
                        <span className="loading loading-spinner loading-xs" />{" "}
                        Saving…
                      </>
                    ) : (
                      <>💾 Save</>
                    )}
                  </button>
                  <button
                    onClick={() => {
                      setTripData(null);
                      setStreamChunks("");
                      setStreamPhase("");
                    }}
                    className="btn btn-outline btn-sm"
                  >
                    ✏️ New Trip
                  </button>
                </div>
              </div>

              {/* Day tabs */}
              {tripData.itinerary?.daily_plans?.length > 0 && (
                <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-none">
                  {tripData.itinerary.daily_plans.map((d, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveDay(i)}
                      className={`btn btn-xs flex-shrink-0 transition-all ${
                        activeDay === i
                          ? "btn-primary"
                          : "btn-ghost text-base-content/60"
                      }`}
                    >
                      Day {d.day}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Main content */}
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-6">
            {/* Itinerary for active day */}
            <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-5 sm:p-7">
              {renderItinerary()}
            </div>

            {/* Cost summary */}
            {renderCostSummary()}

            {/* Top 10 highlights */}
            {tripData.itinerary?.top_10_places?.length > 0 && (
              <div className="card bg-base-100 border border-base-200 shadow-sm">
                <div className="card-body p-5">
                  <h4 className="font-bold text-base mb-3">
                    🏆 Top 10 Highlights
                  </h4>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {tripData.itinerary.top_10_places.map((place, i) => (
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
            {tripData.itinerary?.research?.local_tips?.length > 0 && (
              <div className="card bg-base-100 border border-base-200 shadow-sm">
                <div className="card-body p-5">
                  <h4 className="font-bold text-base mb-3">💡 Local Tips</h4>
                  <ul className="space-y-2">
                    {tripData.itinerary.research.local_tips.map((tip, i) => (
                      <li
                        key={i}
                        className="flex items-start gap-2 text-sm text-base-content/70"
                      >
                        <span className="text-primary mt-0.5">→</span>
                        {tip}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            )}

            {/* Hotels */}
            <div className="bg-base-100 rounded-xl shadow-sm border border-base-200 p-5 sm:p-7">
              <h3 className="text-xl font-bold mb-4 flex items-center gap-2">
                🏨 Recommended Hotels
              </h3>
              {renderRecommendedHotels()}
            </div>

            {/* Photographer credit */}
            {tripData.itinerary?.hero_image?.photographer && (
              <p className="text-xs text-base-content/30 text-center">
                Hero photo by{" "}
                <a
                  href={tripData.itinerary.hero_image.photographer_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  {tripData.itinerary.hero_image.photographer}
                </a>{" "}
                on Unsplash
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default TravelPlanner;
