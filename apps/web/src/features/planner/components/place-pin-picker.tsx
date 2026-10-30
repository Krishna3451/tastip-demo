"use client";

import type { Destination } from "@tastip/domain";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";

function pinCoordinates(point: { lat: number; lng: number }) {
  return { lat: point.lat, lng: ((((point.lng + 180) % 360) + 360) % 360) - 180 };
}

export default function PlacePinPicker({
  city,
  point,
  onPick,
}: {
  city: Destination;
  point: { lat: number; lng: number } | null;
  onPick: (point: { lat: number; lng: number }) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const initialPoint = useRef(point);
  const [ready, setReady] = useState(false);
  const [tileError, setTileError] = useState(false);
  useEffect(() => {
    if (!container.current) return;
    const start = initialPoint.current ?? city;
    const view = L.map(container.current, {
      scrollWheelZoom: true,
      zoomAnimation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    }).setView([start.lat, start.lng], 14);
    map.current = view;
    const tiles = L.tileLayer(
      process.env.NEXT_PUBLIC_MAP_TILE_URL ?? "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
      {
        maxZoom: 19,
        attribution:
          '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    ).addTo(view);
    let failures = 0;
    tiles.on("tileerror", () => {
      if (++failures > 3) setTileError(true);
    });
    tiles.on("tileload", () => setTileError(false));
    view.on("click", (event: L.LeafletMouseEvent) =>
      onPickRef.current(pinCoordinates(event.latlng)),
    );
    const resize = new ResizeObserver(() => view.invalidateSize({ animate: false }));
    resize.observe(container.current);
    setReady(true);
    return () => {
      resize.disconnect();
      view.stop();
      view.remove();
      map.current = null;
      marker.current = null;
    };
  }, [city]);
  useEffect(() => {
    const view = map.current;
    if (!view) return;
    if (!point) {
      marker.current?.remove();
      marker.current = null;
      return;
    }
    if (marker.current) marker.current.setLatLng([point.lat, point.lng]);
    else
      marker.current = L.circleMarker([point.lat, point.lng], {
        radius: 10,
        color: "#fffdf5",
        weight: 3,
        fillColor: "#c65a37",
        fillOpacity: 1,
      }).addTo(view);
  }, [point]);
  return (
    <div className="place-pin-picker">
      <p>
        Move the map to your place and use its center, or click to drop a pin. Arrow keys pan a
        focused map; + and − zoom.
      </p>
      <div
        ref={container}
        className="place-pin-map"
        role="application"
        aria-label={`Choose your place location near ${city.name}`}
      />
      {tileError && (
        <p role="status">
          Map tiles could not load. You can enter coordinates below or try again later.
        </p>
      )}
      <button
        type="button"
        className="button button-secondary"
        disabled={!ready}
        onClick={() => {
          const center = map.current?.getCenter();
          if (center) onPick(pinCoordinates(center));
        }}
      >
        Use map center as pin
      </button>
    </div>
  );
}
