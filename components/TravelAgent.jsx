"use client";

import { useState, useRef } from "react";
import toast from "react-hot-toast";

const TravelAgent = ({ userId }) => {
  // Form state
  const [destination, setDestination] = useState("");
  const [country, setCountry] = useState("");
  const [days, setDays] = useState(7);
  const [budget, setBudget] = useState("");
  const [preferences, setPreferences] = useState({
    adventure: false,
    relaxation: false,
    culture: false,
    food: false,
    nature: false,
    shopping: false,
  });

  // Generation state
  const [isGenerating, setIsGenerating] = useState(false);
  const [itinerary, setItinerary] = useState(null);
  const [agentLogs, setAgentLogs] = useState([]);
  const [error, setError] = useState(null);

  // Streaming state
  const [streamChunks, setStreamChunks] = useState("");
  const abortRef = useRef(null);

  // Refinement chat state
  const [refinementQuery, setRefinementQuery] = useState("");
  const [isRefining, setIsRefining] = useState(false);

  // Saved trips
  const [savedTrips, setSavedTrips] = useState([]);
  const [showSavedTrips, setShowSavedTrips] = useState(false);

  const handlePreferenceToggle = (pref) => {
    setPreferences((prev) => ({
      ...prev,
      [pref]: !prev[pref],
    }));
  };

  // ---------------------------------------------------------------
  // SSE streaming trip generation
  // ---------------------------------------------------------------
  const handleGenerateTrip = async (e) => {
    e.preventDefault();

    if (!destination.trim()) {
      toast.error("Please enter a destination");
      return;
    }
    if (days < 1 || days > 30) {
      toast.error("Trip duration must be between 1 and 30 days");
      return;
    }

    try {
      setIsGenerating(true);
      setError(null);
      setAgentLogs([]);
      setItinerary(null);
      setStreamChunks("");

      const controller = new AbortController();
      abortRef.current = controller;

      setAgentLogs((prev) => [
        ...prev,
        {
          agent: "system",
          message: "Initializing multi-agent planning system...",
          timestamp: new Date(),
        },
      ]);

      const response = await fetch("/api/travel/generate/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          city: destination,
          country: country || "Auto-detect",
          days: parseInt(days),
          budget: budget ? parseFloat(budget) : null,
          preferences: Object.keys(preferences).filter((k) => preferences[k]),
          user_id: userId,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        // Fall back to non-streaming endpoint
        const fallbackRes = await fetch("/api/travel/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            city: destination,
            country: country || "Auto-detect",
            days: parseInt(days),
            budget: budget ? parseFloat(budget) : null,
            preferences: Object.keys(preferences).filter(
              (k) => preferences[k]
            ),
            user_id: userId,
          }),
        });
        if (!fallbackRes.ok) {
          const errorData = await fallbackRes.json();
          throw new Error(errorData.error || "Failed to generate trip");
        }
        const data = await fallbackRes.json();
        setItinerary(data);
        setAgentLogs((prev) => [
          ...prev,
          {
            agent: "supervisor",
            message: "Planning workflow completed",
            timestamp: new Date(),
          },
        ]);
        toast.success("Trip plan generated successfully!");
        return;
      }

      // Read SSE stream
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith("data: ")) {
            const dataStr = line.slice(6);
            try {
              const data = JSON.parse(dataStr);

              if (data.phase) {
                const phaseMessages = {
                  starting: "Planning workflow initialized",
                  generating_itinerary:
                    "AI agents generating itinerary...",
                  fetching_travel_data:
                    "Fetching real-time travel data from Amadeus...",
                  cache_hit:
                    "Found cached itinerary — loading instantly!",
                };
                setAgentLogs((prev) => [
                  ...prev,
                  {
                    agent: "supervisor",
                    message: phaseMessages[data.phase] || data.phase,
                    timestamp: new Date(),
                  },
                ]);
              } else if (data.text !== undefined) {
                setStreamChunks((prev) => prev + data.text);
              } else if (data.tour) {
                setItinerary(data);
                setAgentLogs((prev) => [
                  ...prev,
                  {
                    agent: "supervisor",
                    message: "Planning workflow completed",
                    timestamp: new Date(),
                  },
                ]);
                toast.success("Trip plan generated successfully!");
              } else if (data.error) {
                throw new Error(data.error);
              }
            } catch (parseErr) {
              // Skip unparseable
            }
          }
        }
      }
    } catch (err) {
      if (err.name === "AbortError") return;
      console.error("Generation error:", err);
      setError(err.message);
      toast.error("Failed to generate trip plan");
    } finally {
      setIsGenerating(false);
      abortRef.current = null;
    }
  };

  const handleRefineItinerary = async (e) => {
    e.preventDefault();

    if (!refinementQuery.trim()) {
      toast.error("Please enter a refinement request");
      return;
    }

    if (!itinerary) {
      toast.error("Generate a trip first before refining");
      return;
    }

    try {
      setIsRefining(true);

      const response = await fetch("/api/travel/refine", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          run_id: itinerary.run_id,
          current_itinerary: itinerary.tour,
          refinement: refinementQuery,
          user_id: userId,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to refine itinerary");
      }

      const data = await response.json();
      setItinerary(data);
      setRefinementQuery("");
      toast.success("Trip plan updated!");
    } catch (err) {
      console.error("Refinement error:", err);
      toast.error("Failed to refine trip plan");
    } finally {
      setIsRefining(false);
    }
  };

  const handleSaveTrip = async () => {
    if (!itinerary) return;

    try {
      const response = await fetch("/api/travel/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          user_id: userId,
          itinerary: itinerary,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to save trip");
      }

      const data = await response.json();
      setSavedTrips((prev) => [data, ...prev]);
      toast.success("Trip saved successfully!");
    } catch (err) {
      console.error("Save error:", err);
      toast.error("Failed to save trip");
    }
  };

  return (
    <div className="max-w-7xl mx-auto">
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left Panel - Input Form */}
        <div className="w-full lg:w-2/5">
          <div className="card bg-base-100 shadow-xl sticky top-4">
            <div className="card-body">
              <h2 className="card-title text-2xl mb-4">
                ✈️ AI Travel Planner
              </h2>

              <form onSubmit={handleGenerateTrip} className="space-y-4">
                {/* Destination */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-semibold">
                      Where do you want to go? *
                    </span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Tokyo, Paris, New York..."
                    className="input input-bordered w-full"
                    value={destination}
                    onChange={(e) => setDestination(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                {/* Country (optional) */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Country (optional)</span>
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Japan, France, USA..."
                    className="input input-bordered w-full"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                {/* Duration */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-semibold">
                      Trip Duration (days) *
                    </span>
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="30"
                    className="input input-bordered w-full"
                    value={days}
                    onChange={(e) => setDays(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                {/* Budget */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text">Budget (USD, optional)</span>
                  </label>
                  <input
                    type="number"
                    placeholder="e.g., 3000"
                    className="input input-bordered w-full"
                    value={budget}
                    onChange={(e) => setBudget(e.target.value)}
                    disabled={isGenerating}
                  />
                </div>

                {/* Preferences */}
                <div className="form-control">
                  <label className="label">
                    <span className="label-text font-semibold">
                      Travel Style
                    </span>
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.keys(preferences).map((pref) => (
                      <label
                        key={pref}
                        className="label cursor-pointer justify-start gap-2"
                      >
                        <input
                          type="checkbox"
                          className="checkbox checkbox-primary checkbox-sm"
                          checked={preferences[pref]}
                          onChange={() => handlePreferenceToggle(pref)}
                          disabled={isGenerating}
                        />
                        <span className="label-text capitalize">{pref}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Generate Button */}
                <button
                  type="submit"
                  className={`btn btn-primary w-full ${
                    isGenerating ? "loading" : ""
                  }`}
                  disabled={isGenerating}
                >
                  {isGenerating ? (
                    <>
                      <span className="loading loading-spinner"></span>
                      Generating Trip...
                    </>
                  ) : (
                    <>
                      <span className="text-xl">✨</span>
                      Generate Trip Plan
                    </>
                  )}
                </button>
              </form>

              {/* Saved Trips Toggle */}
              <div className="divider">OR</div>
              <button
                className="btn btn-outline btn-sm"
                onClick={() => setShowSavedTrips(!showSavedTrips)}
              >
                📚 View Saved Trips ({savedTrips.length})
              </button>
            </div>
          </div>
        </div>

        {/* Right Panel - Results */}
        <div className="w-full lg:w-3/5">
          {/* Agent Logs */}
          {agentLogs.length > 0 && (
            <div className="card bg-base-100 shadow-xl mb-6">
              <div className="card-body">
                <h3 className="card-title text-lg">🤖 Agent Activity</h3>
                <div className="space-y-2 max-h-48 overflow-y-auto">
                  {agentLogs.map((log, idx) => (
                    <div
                      key={idx}
                      className="text-sm flex items-start gap-2 p-2 bg-base-200 rounded"
                    >
                      <span className="font-mono text-xs opacity-60">
                        {log.timestamp.toLocaleTimeString()}
                      </span>
                      <span className="font-semibold capitalize">
                        {log.agent}:
                      </span>
                      <span>{log.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Streaming Preview */}
          {isGenerating && streamChunks && (
            <div className="card bg-base-100 shadow-xl mb-6">
              <div className="card-body">
                <div className="flex items-center gap-2 mb-2">
                  <span className="loading loading-dots loading-xs"></span>
                  <h3 className="card-title text-lg">Building Your Itinerary...</h3>
                </div>
                <pre className="text-xs text-base-content/60 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto bg-base-200 p-3 rounded-lg">
                  {streamChunks.slice(-800)}
                </pre>
              </div>
            </div>
          )}

          {/* Error Display */}
          {error && (
            <div className="alert alert-error shadow-lg mb-6">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="stroke-current shrink-0 h-6 w-6"
                fill="none"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="2"
                  d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span>{error}</span>
            </div>
          )}

          {/* Itinerary Display */}
          {itinerary && itinerary.tour && (
            <div className="space-y-6">
              {/* Trip Header */}
              <div className="card bg-gradient-to-br from-primary to-secondary text-primary-content shadow-xl">
                <div className="card-body">
                  <h2 className="card-title text-3xl">
                    {itinerary.tour.title || "Your Trip Plan"}
                  </h2>
                  <p className="text-lg opacity-90">
                    {itinerary.tour.description || ""}
                  </p>
                  <div className="flex gap-4 mt-4">
                    <div className="badge badge-lg">
                      📍 {itinerary.tour.city}, {itinerary.tour.country}
                    </div>
                    {itinerary.tour.stops && (
                      <div className="badge badge-lg">
                        🎯 {itinerary.tour.stops.length} stops
                      </div>
                    )}
                  </div>
                  <div className="card-actions justify-end mt-4">
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={handleSaveTrip}
                    >
                      💾 Save Trip
                    </button>
                  </div>
                </div>
              </div>

              {/* Trip Details */}
              <div className="card bg-base-100 shadow-xl">
                <div className="card-body">
                  <h3 className="card-title">📋 Itinerary Details</h3>

                  {/* Stops */}
                  {itinerary.tour.stops && itinerary.tour.stops.length > 0 && (
                    <div className="space-y-2">
                      <h4 className="font-semibold">Places to Visit:</h4>
                      <ul className="space-y-2">
                        {itinerary.tour.stops.map((stop, idx) => (
                          <li key={idx} className="flex items-center gap-2">
                            <span className="badge badge-primary badge-sm">
                              {idx + 1}
                            </span>
                            <span>{stop}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Daily Plans - Hour by Hour Schedule */}
                  {itinerary.tour.daily_plans && itinerary.tour.daily_plans.length > 0 && (
                    <div className="mt-6">
                      <h4 className="font-semibold text-lg mb-4">📅 Detailed Daily Plans (7 AM - 8 PM)</h4>
                      <div className="space-y-6">
                        {itinerary.tour.daily_plans.map((dayPlan, dayIdx) => (
                          <div key={dayIdx} className="collapse collapse-arrow bg-base-200">
                            <input type="checkbox" defaultChecked={dayIdx === 0} />
                            <div className="collapse-title text-lg font-semibold">
                              <div className="flex items-center justify-between">
                                <span>
                                  Day {dayPlan.day}: {dayPlan.theme}
                                </span>
                                <span className="text-sm opacity-70 mr-4">
                                  {dayPlan.total_activities || dayPlan.plan?.length || 0} activities
                                </span>
                              </div>
                            </div>
                            <div className="collapse-content">
                              <div className="space-y-3 pt-2">
                                {/* Timeline of activities */}
                                {dayPlan.plan && dayPlan.plan.map((activity, actIdx) => (
                                  <div key={actIdx} className="flex gap-4 items-start">
                                    <div className="flex-shrink-0 w-20 text-right">
                                      <span className="badge badge-primary badge-sm">
                                        {activity.time}
                                      </span>
                                    </div>
                                    <div className="flex-grow bg-base-100 p-3 rounded-lg">
                                      <div className="font-semibold">{activity.activity}</div>
                                      <div className="text-sm opacity-70 flex items-center gap-1 mt-1">
                                        <span>📍</span>
                                        <span>{activity.location}</span>
                                      </div>
                                      {activity.duration && (
                                        <div className="text-xs opacity-60 mt-1">
                                          ⏱️ {activity.duration}
                                        </div>
                                      )}
                                      {activity.notes && (
                                        <div className="text-sm mt-2 opacity-80">
                                          💡 {activity.notes}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}

                                {/* Day summary */}
                                {(dayPlan.estimated_walking || dayPlan.tips) && (
                                  <div className="bg-info bg-opacity-10 p-3 rounded-lg mt-4">
                                    {dayPlan.estimated_walking && (
                                      <div className="text-sm">
                                        <strong>🚶 Walking:</strong> {dayPlan.estimated_walking}
                                      </div>
                                    )}
                                    {dayPlan.tips && (
                                      <div className="text-sm mt-2">
                                        <strong>💡 Tip:</strong> {dayPlan.tips}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Real Travel Data from Amadeus */}
                  {itinerary.tour.real_data && itinerary.tour.real_data.has_real_data && (
                    <div className="mt-4">
                      <div className="alert alert-success">
                        <svg xmlns="http://www.w3.org/2000/svg" className="stroke-current shrink-0 h-6 w-6" fill="none" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                        <span>✈️ Real-time travel data from Amadeus API</span>
                      </div>

                      {/* Real Flight Data */}
                      {itinerary.tour.real_data.flights && itinerary.tour.real_data.flights.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-2">✈️ Available Flights:</h4>
                          <div className="space-y-2">
                            {itinerary.tour.real_data.flights.slice(0, 3).map((flight, idx) => (
                              <div key={idx} className="bg-base-200 p-4 rounded-lg">
                                <div className="flex justify-between items-center">
                                  <div>
                                    <p className="font-semibold">Flight Option {idx + 1}</p>
                                    {flight.itineraries && flight.itineraries[0] && (
                                      <p className="text-sm opacity-70">
                                        {flight.itineraries[0].segments && flight.itineraries[0].segments[0] && (
                                          <>
                                            {flight.itineraries[0].segments[0].departure.airport} → {flight.itineraries[0].segments[flight.itineraries[0].segments.length - 1].arrival.airport}
                                          </>
                                        )}
                                      </p>
                                    )}
                                  </div>
                                  <div className="text-right">
                                    <p className="text-xl font-bold text-primary">
                                      {flight.price.currency} {parseFloat(flight.price.total).toFixed(2)}
                                    </p>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Real Hotel Data */}
                      {itinerary.tour.real_data.hotels && itinerary.tour.real_data.hotels.length > 0 && (
                        <div className="mt-4">
                          <h4 className="font-semibold mb-2">🏨 Recommended Hotels:</h4>
                          <div className="space-y-2">
                            {itinerary.tour.real_data.hotels.slice(0, 5).map((hotel, idx) => (
                              <div key={idx} className="bg-base-200 p-3 rounded-lg">
                                <p className="font-semibold">{hotel.name}</p>
                                {hotel.address && hotel.address.cityName && (
                                  <p className="text-sm opacity-70">{hotel.address.cityName}</p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Research Insights */}
                  {itinerary.tour.research && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">🔍 Local Insights:</h4>
                      <div className="bg-base-200 p-4 rounded-lg space-y-2">
                        {itinerary.tour.research.weather && (
                          <p>
                            <strong>Weather:</strong>{" "}
                            {itinerary.tour.research.weather}
                          </p>
                        )}
                        {itinerary.tour.research.local_tips && (
                          <p>
                            <strong>Tips:</strong>{" "}
                            {itinerary.tour.research.local_tips}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Compliance Info */}
                  {itinerary.tour.compliance && (
                    <div className="mt-4">
                      <h4 className="font-semibold mb-2">
                        ⚠️ Travel Requirements:
                      </h4>
                      <div className="bg-base-200 p-4 rounded-lg space-y-2">
                        <p>
                          <strong>Visa Required:</strong>{" "}
                          {itinerary.tour.compliance.visa_required
                            ? "Yes"
                            : "No"}
                        </p>
                        <p>
                          <strong>Safety Level:</strong>{" "}
                          {itinerary.tour.compliance.safety_level || "N/A"}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Citations */}
                  {itinerary.citations && itinerary.citations.length > 0 && (
                    <div className="mt-4">
                      <details className="collapse collapse-arrow bg-base-200">
                        <summary className="collapse-title font-semibold">
                          📚 Sources & Citations
                        </summary>
                        <div className="collapse-content">
                          <ul className="list-disc list-inside space-y-1">
                            {itinerary.citations.map((citation, idx) => (
                              <li key={idx} className="text-sm">
                                {citation}
                              </li>
                            ))}
                          </ul>
                        </div>
                      </details>
                    </div>
                  )}
                </div>
              </div>

              {/* Refinement Chat */}
              <div className="card bg-base-100 shadow-xl">
                <div className="card-body">
                  <h3 className="card-title">💬 Refine Your Trip</h3>
                  <p className="text-sm opacity-70">
                    Ask the AI to modify your itinerary
                  </p>

                  <form onSubmit={handleRefineItinerary} className="mt-4">
                    <div className="form-control">
                      <textarea
                        className="textarea textarea-bordered h-24"
                        placeholder="e.g., 'Make day 2 less busy' or 'Add more museums'"
                        value={refinementQuery}
                        onChange={(e) => setRefinementQuery(e.target.value)}
                        disabled={isRefining}
                      />
                    </div>
                    <button
                      type="submit"
                      className={`btn btn-primary mt-2 ${
                        isRefining ? "loading" : ""
                      }`}
                      disabled={isRefining}
                    >
                      {isRefining ? "Refining..." : "Update Trip"}
                    </button>
                  </form>
                </div>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!isGenerating && !itinerary && !error && (
            <div className="card bg-base-100 shadow-xl">
              <div className="card-body items-center text-center">
                <div className="text-6xl mb-4">🗺️</div>
                <h3 className="text-2xl font-bold">Ready to Plan Your Trip?</h3>
                <p className="text-base-content/70 mt-2">
                  Fill in the form on the left and let our AI agents create a
                  personalized itinerary for you!
                </p>
                <div className="mt-6 space-y-2 text-left">
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🤖</span>
                    <span>Multi-agent AI orchestration</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">🧠</span>
                    <span>RAG-enhanced recommendations</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">⚡</span>
                    <span>Real-time planning with agent reasoning</span>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Saved Trips Modal */}
      {showSavedTrips && (
        <div className="modal modal-open">
          <div className="modal-box max-w-4xl">
            <h3 className="font-bold text-lg mb-4">📚 Saved Trips</h3>

            {savedTrips.length === 0 ? (
              <div className="text-center py-8 text-base-content/50">
                <p>No saved trips yet. Generate and save your first trip!</p>
              </div>
            ) : (
              <div className="space-y-4">
                {savedTrips.map((trip, idx) => (
                  <div
                    key={idx}
                    className="card bg-base-200 hover:bg-base-300 cursor-pointer"
                  >
                    <div className="card-body">
                      <h4 className="card-title">{trip.title}</h4>
                      <p className="text-sm opacity-70">{trip.description}</p>
                      <div className="card-actions justify-end">
                        <button className="btn btn-sm btn-primary">
                          View
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="modal-action">
              <button
                className="btn"
                onClick={() => setShowSavedTrips(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TravelAgent;

