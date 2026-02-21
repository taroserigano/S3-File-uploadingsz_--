"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  GoogleMap,
  useJsApiLoader,
  Marker,
  Polyline,
  InfoWindow,
} from "@react-google-maps/api";

const MAP_CONTAINER_STYLE = {
  width: "100%",
  height: "320px",
  borderRadius: "0.75rem",
};
const DEFAULT_CENTER = { lat: 48.8566, lng: 2.3522 }; // Paris fallback
const MAP_OPTIONS = {
  disableDefaultUI: false,
  zoomControl: true,
  streetViewControl: false,
  mapTypeControl: false,
  fullscreenControl: true,
  // maxZoom removed so pins at different locations are distinguishable;
  // fitBounds zoom is capped programmatically at 14 after geocoding.
};
const POLYLINE_OPTIONS = {
  strokeColor: "#6366f1",
  strokeOpacity: 0.8,
  strokeWeight: 3,
  geodesic: true,
};

// Color palette for numbered markers (matches DaisyUI primary palette)
const MARKER_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#3b82f6", // blue
  "#ec4899", // pink
  "#8b5cf6", // violet
  "#14b8a6", // teal
];

/**
 * Create an SVG data-URI marker pin with a number label.
 */
function numberedPin(index, color) {
  const num = index + 1;
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="42" viewBox="0 0 32 42">
      <path d="M16 0C7.16 0 0 7.16 0 16c0 12 16 26 16 26s16-14 16-26C32 7.16 24.84 0 16 0z" fill="${color}" stroke="#fff" stroke-width="1.5"/>
      <circle cx="16" cy="15" r="10" fill="#fff"/>
      <text x="16" y="19" text-anchor="middle" font-family="Arial,sans-serif" font-weight="bold" font-size="12" fill="${color}">${num}</text>
    </svg>`;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

/**
 * Haversine distance in km between two lat/lng points.
 */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Max distance (km) from city center before a geocoded result is rejected
const MAX_CITY_RADIUS_KM = 50;

/**
 * Build a search query from an activity's location data.
 */
function locationQuery(activity, city) {
  const loc = activity.location;
  if (!loc) return activity.name + (city ? `, ${city}` : "");
  const addr = loc.address || "";
  const name = loc.name || "";
  // Combine name + address for best geocoding (e.g. "Pike Place Market, 85 Pike St, Seattle")
  let base = "";
  if (addr && name && addr !== name) {
    base = `${name}, ${addr}`;
  } else {
    base = addr || name || activity.name;
  }
  // Append city for better geocoding if not already included
  if (city && !base.toLowerCase().includes(city.toLowerCase())) {
    return `${base}, ${city}`;
  }
  return base;
}

/**
 * DayMapView – renders a Google Map for one day of activities.
 *
 * Props:
 *   activities  – array of activity objects (each has .name, .location, .time)
 *   city        – destination city string (for geocoding context)
 *   dayNumber   – which day (for labels)
 */
export default function DayMapView({
  activities = [],
  city = "",
  dayNumber = 1,
}) {
  const { isLoaded, loadError } = useJsApiLoader({
    googleMapsApiKey: process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "",
    // Prevent duplicate loading across multiple DayMapView instances
    id: "google-maps-script",
  });

  const [markers, setMarkers] = useState([]);
  const [activeIdx, setActiveIdx] = useState(null);
  const [isOpen, setIsOpen] = useState(true);
  const [geocoder, setGeocoder] = useState(null);
  const mapRef = useRef(null);
  const initialCenterRef = useRef(DEFAULT_CENTER);

  // Stable fingerprint: only recompute when activity CONTENT changes,
  // not when a new array reference is passed from the parent.
  const activitiesFingerprint = activities
    .map(
      (a) => `${a.name}|${a.location?.address || ""}|${a.location?.name || ""}`,
    )
    .join("\n");

  const queries = useMemo(
    () => activities.map((a) => locationQuery(a, city)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [activitiesFingerprint, city],
  );

  // Keep a ref so the effect can access the latest activities without
  // re-triggering when the array reference changes.
  const activitiesRef = useRef(activities);
  activitiesRef.current = activities;

  const onMapLoad = useCallback(
    (map) => {
      mapRef.current = map;
      const gc = new window.google.maps.Geocoder();
      setGeocoder(gc);

      // Geocode the city and pan there imperatively (no state update = no re-render)
      if (city) {
        gc.geocode({ address: city }, (results, status) => {
          if (status === "OK" && results?.[0]) {
            const loc = results[0].geometry.location;
            map.panTo({ lat: loc.lat(), lng: loc.lng() });
          }
        });
      }
    },
    [city],
  );

  // Stable string key so the effect doesn't restart when the parent
  // passes a structurally-identical-but-reference-different array.
  const queriesKey = queries.join("\n");

  // Geocode all activities once the map + geocoder are ready
  useEffect(() => {
    if (!isLoaded || !geocoder || queries.length === 0) return;

    let cancelled = false;

    // Helper: try geocoding a query, returns {lat,lng,formatted_address} or null
    function tryGeocode(query) {
      return new Promise((resolve) => {
        geocoder.geocode({ address: query }, (r, status) => {
          if (status === "OK" && r?.[0]) {
            const loc = r[0].geometry.location;
            resolve({
              lat: loc.lat(),
              lng: loc.lng(),
              formatted_address: r[0].formatted_address || "",
            });
          } else {
            resolve(null);
          }
        });
      });
    }

    async function geocodeAll() {
      const acts = activitiesRef.current; // stable snapshot
      console.log(
        `[DayMapView] Geocoding ${queries.length} activities for ${city}`,
      );

      // First, geocode the city itself so we have a fallback center
      let cityLat = null,
        cityLng = null;
      const cityResult = await tryGeocode(city);
      if (cityResult) {
        cityLat = cityResult.lat;
        cityLng = cityResult.lng;
      }

      const results = [];
      for (let i = 0; i < queries.length; i++) {
        if (cancelled) {
          console.log(`[DayMapView] Cancelled at item ${i}`);
          return;
        }

        // Helper: check if position is within city radius
        const isWithinCity = (p) =>
          cityLat !== null &&
          cityLng !== null &&
          haversineKm(cityLat, cityLng, p.lat, p.lng) <= MAX_CITY_RADIUS_KM;

        // Try 1: full query (address + city)
        let pos = await tryGeocode(queries[i]);
        let method = "address";

        // Verify: reject if geocoded location is too far from the target city
        if (pos && !isWithinCity(pos)) {
          const dist = haversineKm(cityLat, cityLng, pos.lat, pos.lng).toFixed(
            0,
          );
          console.warn(
            `[DayMapView]  ⚠ ${i + 1}. ${acts[i]?.name} geocoded ${dist}km away – re-geocoding with city name`,
          );
          pos = null; // force fallback
        }

        // Try 2: just activity name + city
        if (!pos && acts[i]?.name) {
          const fallbackQuery = `${acts[i].name}, ${city}`;
          pos = await tryGeocode(fallbackQuery);
          method = "name+city";
          // Also verify distance for fallback
          if (pos && !isWithinCity(pos)) {
            console.warn(
              `[DayMapView]  ⚠ ${i + 1}. ${acts[i]?.name} still too far after name+city fallback – scattering`,
            );
            pos = null;
          }
          await new Promise((r) => setTimeout(r, 150));
        }

        // Try 3: scatter around city center with a small offset so pins don't stack
        if (!pos && cityLat !== null && cityLng !== null) {
          const angle = (i / queries.length) * 2 * Math.PI;
          const offset = 0.008 + Math.random() * 0.004; // ~800m-1.2km radius
          pos = {
            lat: cityLat + offset * Math.sin(angle),
            lng: cityLng + offset * Math.cos(angle),
            formatted_address: `(approximate location in ${city})`,
          };
          method = "scatter";
        }

        if (pos) {
          console.log(
            `[DayMapView]  ✓ ${i + 1}. ${acts[i]?.name} → ${method} (${pos.lat.toFixed(4)}, ${pos.lng.toFixed(4)})`,
          );
          results.push({
            lat: pos.lat,
            lng: pos.lng,
            formatted_address: pos.formatted_address || "",
            activity: acts[i],
            index: i,
          });
        } else {
          console.warn(
            `[DayMapView]  ✗ ${i + 1}. ${acts[i]?.name} → no position`,
          );
        }

        // Delay between geocode calls to respect rate limits
        if (i < queries.length - 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      }

      if (cancelled || results.length === 0) return;
      console.log(`[DayMapView] Setting ${results.length} markers`);
      setMarkers(results);

      // Fit bounds to all markers, then enforce maxZoom cap
      const FIT_MAX_ZOOM = 14;
      if (mapRef.current && results.length > 1) {
        const bounds = new window.google.maps.LatLngBounds();
        results.forEach((m) => bounds.extend({ lat: m.lat, lng: m.lng }));
        mapRef.current.fitBounds(bounds, {
          top: 50,
          bottom: 50,
          left: 50,
          right: 50,
        });
        // fitBounds may ignore maxZoom – enforce it manually
        window.google.maps.event.addListenerOnce(mapRef.current, "idle", () => {
          if (mapRef.current && mapRef.current.getZoom() > FIT_MAX_ZOOM) {
            mapRef.current.setZoom(FIT_MAX_ZOOM);
          }
        });
      } else if (mapRef.current && results.length === 1) {
        mapRef.current.panTo({ lat: results[0].lat, lng: results[0].lng });
        mapRef.current.setZoom(FIT_MAX_ZOOM);
      }
    }

    geocodeAll();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, geocoder, queriesKey, city]);

  // Build polyline path from markers (in order)
  const polylinePath = useMemo(
    () => markers.map((m) => ({ lat: m.lat, lng: m.lng })),
    [markers],
  );

  // Toggle expand/collapse
  const toggleMap = () => setIsOpen((o) => !o);

  if (loadError) {
    return (
      <div className="text-sm text-error p-2">
        Failed to load Google Maps. Check your API key.
      </div>
    );
  }

  return (
    <div className="mt-4">
      <button
        onClick={toggleMap}
        className="btn btn-sm btn-outline btn-primary gap-2 mb-2"
      >
        🗺️ {isOpen ? "Hide Map" : "Show Route Map"}
      </button>

      {isOpen && (
        <div className="relative">
          {!isLoaded ? (
            <div
              className="flex items-center justify-center bg-base-200 rounded-xl"
              style={{ height: 320 }}
            >
              <span className="loading loading-spinner loading-lg text-primary"></span>
            </div>
          ) : (
            <GoogleMap
              mapContainerStyle={MAP_CONTAINER_STYLE}
              center={initialCenterRef.current}
              zoom={10}
              options={MAP_OPTIONS}
              onLoad={onMapLoad}
            >
              {markers.map((m, i) => (
                <Marker
                  key={i}
                  position={{ lat: m.lat, lng: m.lng }}
                  icon={{
                    url: numberedPin(
                      i,
                      MARKER_COLORS[i % MARKER_COLORS.length],
                    ),
                    scaledSize: new window.google.maps.Size(32, 42),
                    anchor: new window.google.maps.Point(16, 42),
                  }}
                  title={`${i + 1}. ${m.activity.name}`}
                  onClick={() => setActiveIdx(i)}
                />
              ))}

              {activeIdx !== null && markers[activeIdx] && (
                <InfoWindow
                  position={{
                    lat: markers[activeIdx].lat,
                    lng: markers[activeIdx].lng,
                  }}
                  onCloseClick={() => setActiveIdx(null)}
                >
                  <div className="p-1 max-w-[260px]">
                    <p className="font-bold text-sm text-gray-900">
                      {activeIdx + 1}. {markers[activeIdx].activity.name}
                    </p>
                    {markers[activeIdx].activity.time && (
                      <p className="text-xs text-gray-600 mt-1">
                        🕐 {markers[activeIdx].activity.time}
                      </p>
                    )}
                    {/* Always show address: geocoded → activity location → geocode query */}
                    <p className="text-xs text-gray-500 mt-0.5">
                      📍{" "}
                      {markers[activeIdx].formatted_address ||
                        markers[activeIdx].activity.location?.address ||
                        markers[activeIdx].activity.location?.name ||
                        markers[activeIdx].activity.name}
                    </p>
                  </div>
                </InfoWindow>
              )}

              {polylinePath.length > 1 && (
                <Polyline path={polylinePath} options={POLYLINE_OPTIONS} />
              )}
            </GoogleMap>
          )}

          {/* Legend strip below map */}
          {markers.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 px-1">
              {markers.map((m, i) => (
                <button
                  key={i}
                  onClick={() => {
                    setActiveIdx(i);
                    mapRef.current?.panTo({ lat: m.lat, lng: m.lng });
                  }}
                  className="badge badge-sm gap-1 cursor-pointer hover:opacity-80 transition-opacity"
                  style={{
                    backgroundColor: MARKER_COLORS[i % MARKER_COLORS.length],
                    color: "#fff",
                    border: "none",
                  }}
                  title={
                    m.formatted_address || m.activity.location?.address || ""
                  }
                >
                  {i + 1}. {m.activity.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
