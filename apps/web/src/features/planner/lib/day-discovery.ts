import {
  type Destination,
  destinationForDay,
  feedbackTasteSignals,
  getTripDestination,
  type Place,
  parseTasteProfile,
  type Trip,
  validDestination,
} from "@tastip/domain";
import { z } from "zod";
import { parseSavedPlaces } from "./saved-places";

export const DAY_DISCOVERY_RADII = [2000, 8000, 20000, 50000] as const;
export type DayDiscoveryRadius = (typeof DAY_DISCOVERY_RADII)[number];
export type DayDiscoveryStatus = "idle" | "loading" | "ready" | "stopped" | "error" | "unavailable";
export type DayDiscoveryBinding = Readonly<{
  scope: string;
  tripId: string;
  version: number;
  dayId: string;
  destinationId: string;
  radiusMetres: DayDiscoveryRadius;
  requestId: string;
}>;
export type DayDiscoveryContext = Readonly<{
  key: string;
  scope: string;
  tripId: string;
  version: number;
  dayId: string;
  destination: Readonly<Destination>;
  radiusMetres: DayDiscoveryRadius;
  /** Only these bounded request fields are transmitted, never the trip or personal profile. */
  requestBody: string;
}>;
export type DayDiscoverySnapshot = {
  contextKey: string | null;
  status: DayDiscoveryStatus;
  candidates: Place[];
  error: string;
  binding: DayDiscoveryBinding | null;
};
export type DayDiscoveryAccess = {
  context: DayDiscoveryContext | null;
  enabled: boolean;
  active: boolean;
  blockedReason: string;
};
export type DayDiscoveryTransport = (url: string, init: RequestInit) => Promise<Response>;

const requestSchema = z.object({
  entityIds: z.array(z.string().uuid()).min(1).max(20),
  destinationId: z.string().min(1).max(100),
  destination: z.custom<Destination>(validDestination),
  radiusMetres: z.number().int().min(500).max(50_000),
  take: z.literal(20),
  categories: z.array(z.enum(["cafe", "culture", "food", "outdoors", "shop"])).max(5),
  excludedIds: z.array(z.string().max(100)).max(150),
});
export function isDayDiscoveryRadius(value: number): value is DayDiscoveryRadius {
  return DAY_DISCOVERY_RADII.some((radius) => radius === value);
}

/** Capture one explicit city/day and its confirmed query inputs without changing the trip. */
export function prepareDayDiscovery(
  trip: Trip | null,
  dayId: string,
  scope: string,
  radius: number,
) {
  if (!trip || !trip.days.some((day) => day.id === dayId))
    return { context: null, destination: null, error: "Choose a day in your current trip first." };
  const city = getTripDestination(trip, destinationForDay(trip, dayId));
  if (!validDestination(city))
    return {
      context: null,
      destination: null,
      error: "Review this day’s city before finding places.",
    };
  // Imported cities may contain arbitrary extensions; transmit only domain coordinates/labels.
  const destination = Object.freeze({
    id: city.id,
    name: city.name,
    country: city.country,
    lat: city.lat,
    lng: city.lng,
    timeZone: city.timeZone,
  });
  if (!scope.trim() || !isDayDiscoveryRadius(radius))
    return { context: null, destination, error: "Choose a supported recommendation radius." };
  const profile = parseTasteProfile(trip.brief.tasteProfile);
  if (!profile?.seeds.length)
    return {
      context: null,
      destination,
      error: "Confirm at least one cultural favorite before finding places.",
    };
  const request = requestSchema.safeParse({
    entityIds: profile.seeds.map((seed) => seed.id),
    destinationId: destination.id,
    destination,
    radiusMetres: radius,
    take: 20,
    categories: profile.categories,
    excludedIds: feedbackTasteSignals(trip).excludedIds,
  });
  if (!request.success)
    return {
      context: null,
      destination,
      error: "Review your confirmed favorites and trip feedback before finding places.",
    };
  const requestBody = JSON.stringify(request.data);
  const key = JSON.stringify([scope, trip.id, trip.version, dayId, requestBody]);
  const context: DayDiscoveryContext = Object.freeze({
    key,
    scope,
    tripId: trip.id,
    version: trip.version,
    dayId,
    destination,
    radiusMetres: radius,
    requestBody,
  });
  return { context, destination, error: "" };
}

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
/** Each response is one query. Never backfill missing response evidence from canonical places. */
export function parseDayDiscoveryCandidates(body: unknown, destination: Destination): Place[] {
  const invalid = () =>
    new Error(
      "These Qloo recommendations could not be verified. Your trip is unchanged; retry to find places again.",
    );
  if (
    !object(body) ||
    !Array.isArray(body.selected) ||
    body.selected.length > 20 ||
    (body.provider !== undefined && body.provider !== "qloo") ||
    (body.queryId !== undefined && (typeof body.queryId !== "string" || !body.queryId.trim()))
  )
    throw invalid();
  if (body.selected.some((place) => !object(place) || place.destinationId !== destination.id))
    throw invalid();
  const records = parseSavedPlaces(
    JSON.stringify(body.selected.map((place) => ({ place, destination }))),
  );
  if (
    !records ||
    records.some(
      ({ place }) =>
        place.source !== "qloo" || !place.taste || !Number.isSafeInteger(place.taste.rank),
    )
  )
    throw invalid();
  const queries = new Set(records.map(({ place }) => place.taste?.queryId));
  const ranks = new Set(records.map(({ place }) => place.taste?.rank));
  if (
    queries.size > 1 ||
    ranks.size !== records.length ||
    (body.queryId !== undefined &&
      records.some(({ place }) => place.taste?.queryId !== body.queryId))
  )
    throw invalid();
  return records.map(({ place }) => place);
}

export function emptyDayDiscovery(contextKey: string | null = null): DayDiscoverySnapshot {
  return { contextKey, status: "idle", candidates: [], error: "", binding: null };
}

/** Explicit request state machine, also used by contract tests without mounting a browser. */
export class DayDiscoveryController {
  private snapshot = emptyDayDiscovery();
  private accessKey = "";
  private generation = 0;
  private request: AbortController | null = null;
  private retryContext: DayDiscoveryContext | null = null;
  constructor(
    private readonly access: () => DayDiscoveryAccess,
    private readonly changed: (snapshot: DayDiscoverySnapshot) => void,
    private readonly transport: DayDiscoveryTransport = (url, init) => fetch(url, init),
  ) {}
  getSnapshot() {
    return this.snapshot;
  }
  private publish(snapshot: DayDiscoverySnapshot) {
    this.snapshot = snapshot;
    this.changed(snapshot);
  }
  private abort() {
    this.generation++;
    this.request?.abort();
    this.request = null;
  }
  synchronize() {
    const access = this.access();
    const key = JSON.stringify([
      access.context?.key,
      access.enabled,
      access.active,
      access.blockedReason,
    ]);
    if (key === this.accessKey) return;
    this.accessKey = key;
    this.abort();
    this.retryContext = null;
    this.publish({
      ...emptyDayDiscovery(access.context?.key ?? null),
      status: !access.enabled || !access.context ? "unavailable" : "idle",
    });
  }
  dispose() {
    this.abort();
    this.retryContext = null;
    this.accessKey = "";
  }
  clear() {
    this.abort();
    this.retryContext = null;
    this.publish(emptyDayDiscovery(this.access().context?.key ?? null));
  }
  stop() {
    this.synchronize();
    if (this.snapshot.status !== "loading") return;
    this.abort();
    this.publish({ ...this.snapshot, status: "stopped", candidates: [], error: "" });
  }
  isCurrent(binding: DayDiscoveryBinding) {
    const access = this.access();
    const context = access.context;
    return (
      access.active &&
      access.enabled &&
      context !== null &&
      context.key === this.snapshot.contextKey &&
      this.snapshot.status === "ready" &&
      this.snapshot.binding?.requestId === binding.requestId &&
      binding.scope === context.scope &&
      binding.tripId === context.tripId &&
      binding.version === context.version &&
      binding.dayId === context.dayId &&
      binding.destinationId === context.destination.id &&
      binding.radiusMetres === context.radiusMetres
    );
  }
  async find() {
    this.synchronize();
    const access = this.access();
    if (!access.active || !access.enabled || !access.context || this.request) return false;
    return this.perform(access.context);
  }
  async retry() {
    this.synchronize();
    const access = this.access();
    if (
      !access.active ||
      !access.enabled ||
      !this.retryContext ||
      access.context?.key !== this.retryContext.key ||
      this.request
    )
      return false;
    return this.perform(this.retryContext);
  }
  private async perform(context: DayDiscoveryContext) {
    this.abort();
    const run = this.generation;
    const controller = new AbortController();
    this.request = controller;
    this.retryContext = context;
    const binding = Object.freeze({
      scope: context.scope,
      tripId: context.tripId,
      version: context.version,
      dayId: context.dayId,
      destinationId: context.destination.id,
      radiusMetres: context.radiusMetres,
      requestId: crypto.randomUUID(),
    });
    const live = () => {
      const access = this.access();
      return (
        !controller.signal.aborted &&
        this.generation === run &&
        this.request === controller &&
        access.active &&
        access.enabled &&
        access.context?.key === context.key
      );
    };
    this.publish({
      contextKey: context.key,
      status: "loading",
      candidates: [],
      error: "",
      binding,
    });
    try {
      const response = await this.transport("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: context.requestBody,
        signal: controller.signal,
      });
      const raw = await response.text();
      if (!live()) return false;
      if (new TextEncoder().encode(raw).byteLength > 4_000_000)
        throw new Error("The recommendation response was too large. Your trip is unchanged.");
      let body: unknown;
      try {
        body = JSON.parse(raw);
      } catch {
        throw new Error(
          "The Qloo reply could not be read. Your trip is unchanged; retry when you’re ready.",
        );
      }
      if (!response.ok)
        throw new Error(
          object(body) && object(body.error) && typeof body.error.message === "string"
            ? body.error.message.slice(0, 500)
            : "Qloo recommendations could not connect. Retry when you’re ready.",
        );
      const candidates = parseDayDiscoveryCandidates(body, context.destination);
      if (!live()) return false;
      this.publish({ contextKey: context.key, status: "ready", candidates, error: "", binding });
      return true;
    } catch (cause) {
      if (live())
        this.publish({
          contextKey: context.key,
          status: "error",
          candidates: [],
          binding,
          error:
            cause instanceof Error
              ? cause.message
              : "Qloo recommendations could not connect. Retry when you’re ready.",
        });
      return false;
    } finally {
      if (this.request === controller) this.request = null;
    }
  }
}
