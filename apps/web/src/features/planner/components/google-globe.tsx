"use client";

import type { Destination } from "@tastip/domain";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { type GoogleCamera, type GoogleMap3D, loadGoogleMaps3D } from "@/lib/google-maps-loader";

type Props = {
  destination: Destination;
  fallback: ReactNode;
  /** Only an enabled owner-bound runtime response may activate the SDK. */
  enabled?: boolean;
  /** A dedicated, HTTP-referrer-restricted browser key, never a server-provider secret. */
  apiKey?: string;
};

function cameraFor(destination: Destination, close: boolean): GoogleCamera {
  return {
    center: { lat: destination.lat, lng: destination.lng, altitude: 0 },
    range: close ? 8_000 : 18_000_000,
    tilt: close ? 55 : 0,
    heading: 0,
  };
}

function supportsWebGL() {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2");
  context?.getExtension("WEBGL_lose_context")?.loseContext();
  return Boolean(context);
}

export function GoogleGlobe({ destination, fallback, enabled = false, apiKey }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const map = useRef<GoogleMap3D | null>(null);
  const currentDestination = useRef(destination);
  currentDestination.current = destination;
  const [status, setStatus] = useState<"loading" | "ready" | "unavailable">("loading");
  const [close, setClose] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(preference.matches);
    update();
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    // Eligibility is authoritative; never fall back to build-time or another owner's key.
    if (!enabled || !apiKey || !supportsWebGL()) {
      setStatus("unavailable");
      return;
    }
    const controller = new AbortController();
    let element: GoogleMap3D | null = null;
    let timer: number | undefined;
    const detach = () => {
      window.clearTimeout(timer);
      if (!element) return;
      element.removeEventListener("gmp-error", fail);
      element.removeEventListener("gmp-steadychange", steady);
      element.stopCameraAnimation();
      element.remove();
      if (map.current === element) map.current = null;
    };
    const fail = () => {
      if (controller.signal.aborted) return;
      controller.abort();
      setStatus("unavailable");
      detach();
    };
    const steady = (event: Event) => {
      if (!("isSteady" in event) || event.isSteady !== true || controller.signal.aborted) return;
      window.clearTimeout(timer);
      setStatus("ready");
    };
    setStatus("loading");
    loadGoogleMaps3D(apiKey, controller.signal, fail)
      .then(({ Map3DElement }) => {
        if (controller.signal.aborted || !host.current) return;
        const location = currentDestination.current;
        element = new Map3DElement({
          ...cameraFor(location, false),
          mode: "SATELLITE",
          gestureHandling: "GREEDY",
          defaultUIHidden: false,
          fov: 40,
          description: `Google Maps 3D globe centered on ${location.name}, ${location.country}.`,
        });
        element.style.width = "100%";
        element.style.height = "100%";
        element.addEventListener("gmp-error", fail);
        element.addEventListener("gmp-steadychange", steady);
        map.current = element;
        timer = window.setTimeout(fail, 25_000);
        host.current.appendChild(element);
      })
      .catch(fail);
    return () => {
      controller.abort();
      detach();
    };
  }, [enabled, apiKey]);

  useEffect(() => {
    const element = map.current;
    if (status !== "ready" || !element) return;
    element.description = `Google Maps 3D ${close ? "city view" : "globe"} centered on ${destination.name}, ${destination.country}.`;
    element.stopCameraAnimation();
    element.flyCameraTo({
      endCamera: cameraFor(destination, close),
      durationMillis: reduced ? 0 : 1_400,
    });
  }, [destination, close, reduced, status]);

  if (!enabled || !apiKey || status === "unavailable") return fallback;

  return (
    <>
      <section
        className="google-globe-viewport"
        data-map-provider="google"
        data-map-status={status}
        aria-label={`Google Maps 3D: ${destination.name}, ${destination.country}`}
        aria-busy={status === "loading"}
        style={{ visibility: status === "ready" ? "visible" : "hidden" }}
      >
        {/* Keep this full rectangle unclipped: Google's attribution and controls live here. */}
        <div ref={host} style={{ width: "100%", height: "100%" }} />
        <div className="google-globe-controls">
          <button type="button" onClick={() => setClose((value) => !value)}>
            {close ? "Back to globe" : `View ${destination.name} in 3D`}
          </button>
        </div>
      </section>
      {status === "loading" && (
        <>
          {fallback}
          <span className="sr-only" role="status">
            Loading Google Maps.
          </span>
        </>
      )}
    </>
  );
}
