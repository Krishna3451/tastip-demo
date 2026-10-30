import type { MapsConfiguration } from "@/lib/maps-config";
import { providerAvailable } from "./account-http";
import { localIntegrationEnabled } from "./http";

function localOriginMatches(request: Request) {
  if (!localIntegrationEnabled(request)) return true; // Hosted policy is checked separately.
  try {
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if (fetchSite && fetchSite !== "same-origin") return false;
    const origin = request.headers.get("Origin");
    const referer = request.headers.get("Referer");
    const sourceValue = origin ?? referer;
    if (!sourceValue) return false;
    const source = new URL(sourceValue);
    const target = new URL(request.url);
    return (
      ["localhost", "127.0.0.1", "[::1]"].includes(source.hostname) &&
      source.protocol === target.protocol &&
      source.port === target.port &&
      (!origin || source.origin === origin)
    );
  } catch {
    return false;
  }
}

/** A capability read, not a Google request or a proxy for Google-side billing quotas. */
export function mapsConfiguration(request: Request): MapsConfiguration {
  const key = process.env.GOOGLE_MAPS_BROWSER_KEY?.trim();
  if (
    process.env.TASTIP_ENABLE_GOOGLE_MAPS !== "1" ||
    !key ||
    key.length > 256 ||
    /\s/.test(key) ||
    // Fail closed if an operator accidentally copies a server-only provider key.
    [process.env.OPENAI_API_KEY, process.env.QLOO_API_KEY].some(
      (secret) => secret?.trim() === key,
    ) ||
    !localOriginMatches(request) ||
    !providerAvailable(request)
  )
    return { enabled: false };
  return { enabled: true, provider: "google-maps-3d", apiKey: key };
}
