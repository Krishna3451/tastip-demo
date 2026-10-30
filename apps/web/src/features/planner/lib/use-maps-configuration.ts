"use client";

import { useEffect, useState } from "react";
import type { MapsConfiguration } from "@/lib/maps-config";
import { type ProviderFetch, useProviderFetch } from "@/lib/provider-fetch";

const DISABLED: MapsConfiguration = { enabled: false };
const CONFIG_TIMEOUT_MS = 5_000;

function readConfiguration(value: unknown): MapsConfiguration {
  if (
    !value ||
    typeof value !== "object" ||
    !("enabled" in value) ||
    value.enabled !== true ||
    !("provider" in value) ||
    value.provider !== "google-maps-3d" ||
    !("apiKey" in value) ||
    typeof value.apiKey !== "string" ||
    !value.apiKey ||
    value.apiKey.length > 256 ||
    /\s/.test(value.apiKey)
  )
    return DISABLED;
  return { enabled: true, provider: "google-maps-3d", apiKey: value.apiKey };
}

/** A capability belongs to the transport's rendered owner, never to the previous effect. */
export function useMapsConfiguration(ready: boolean): MapsConfiguration {
  const providerFetch = useProviderFetch();
  const [resolved, setResolved] = useState<{
    transport: ProviderFetch;
    configuration: MapsConfiguration;
  } | null>(null);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CONFIG_TIMEOUT_MS);
    void (async () => {
      try {
        const response = await providerFetch("/api/maps/config", {
          cache: "no-store",
          signal: controller.signal,
        });
        const body: unknown = await response.json();
        if (controller.signal.aborted) return;
        setResolved({
          transport: providerFetch,
          configuration: response.ok ? readConfiguration(body) : DISABLED,
        });
      } catch {
        if (!controller.signal.aborted)
          setResolved({ transport: providerFetch, configuration: DISABLED });
      } finally {
        window.clearTimeout(timeout);
      }
    })();
    return () => {
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, [providerFetch, ready]);

  // Invalidate synchronously during render: effects run after a changed owner has rendered.
  return ready && resolved?.transport === providerFetch ? resolved.configuration : DISABLED;
}
