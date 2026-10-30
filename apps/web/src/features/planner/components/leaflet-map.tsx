"use client";

import type { Destination, Place } from "@tastip/domain";
import type { DrivingRoute } from "@tastip/providers";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";

export default function LeafletMap({
  places,
  destination,
  route,
  onSelect,
  label,
}: {
  places: { stopId: string; place: Place }[];
  destination?: Destination;
  route: DrivingRoute | null;
  onSelect: (stopId: string) => void;
  label?: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const map = L.map(container.current, {
      scrollWheelZoom: true,
      zoomAnimation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    }).setView([destination?.lat ?? 0, destination?.lng ?? 0], 12);
    let failed = 0;
    const tiles = L.tileLayer(
      process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(map);
    tiles.on("tileerror", () => {
      failed++;
      if (failed > 3) setError(true);
    });
    tiles.on("tileload", () => setError(false));
    const markers: L.CircleMarker[] = [];
    places.forEach(({ stopId, place }, index) => {
      const label = document.createElement("span");
      label.textContent = `${index + 1}. ${place.name}`;
      const marker = L.circleMarker([place.lat, place.lng], {
        radius: 10,
        color: "#fffdf5",
        weight: 3,
        fillColor: "#315c4b",
        fillOpacity: 1,
      })
        .addTo(map)
        .bindTooltip(label, { direction: "top" });
      marker.on("click", () => onSelect(stopId));
      markers.push(marker);
    });
    if (route)
      L.polyline(
        route.geometry.map(([lng, lat]) => [lat, lng] as L.LatLngTuple),
        { color: "#517a67", weight: 4, opacity: 0.85 },
      ).addTo(map);
    if (markers.length)
      map.fitBounds(L.featureGroup(markers).getBounds(), {
        padding: [40, 40],
        maxZoom: 15,
        animate: false,
      });
    const resize = new ResizeObserver(() => map.invalidateSize({ animate: false }));
    resize.observe(container.current);
    return () => {
      resize.disconnect();
      map.stop();
      map.remove();
    };
  }, [places, destination, route, onSelect]);
  return (
    <div className="geographic-map-wrap">
      <div
        ref={container}
        role="application"
        className="geographic-map"
        aria-label={
          label ??
          (places.length
            ? "Geographic map of this day’s real places"
            : `City map of ${destination?.name ?? "your destination"} with no visit pins`)
        }
      />
      {error && (
        <p role="status" className="map-tile-error">
          Map tiles could not load.{" "}
          {places.length
            ? "Your places and coordinates remain available below."
            : "City details and day navigation remain available above."}
        </p>
      )}
    </div>
  );
}
