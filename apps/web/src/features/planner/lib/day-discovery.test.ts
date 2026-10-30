import { describe, expect, test } from "bun:test";
import {
  applyTripCommand,
  createDemoTrip,
  DEFAULT_BRIEF,
  getTripDestination,
  type Place,
  parseStoredTrip,
  type Trip,
} from "@tastip/domain";
import {
  type DayDiscoveryAccess,
  DayDiscoveryController,
  type DayDiscoveryTransport,
  parseDayDiscoveryCandidates,
  prepareDayDiscovery,
} from "./day-discovery";

const favorite = {
  id: "00000000-0000-4000-8000-000000000067",
  name: "Synthetic discovery favorite",
  type: "urn:entity:artist",
};
function tripFixture() {
  return createDemoTrip({
    ...DEFAULT_BRIEF,
    days: 2,
    tasteProfile: { seeds: [favorite], dayStyle: "Culture", categories: ["culture"] },
  });
}
function candidate(
  rank = 7,
  queryId = "synthetic-day-query",
  id = `qloo:day-fixture-${rank}`,
): Place {
  return {
    id,
    destinationId: "lisbon",
    name: `Synthetic day candidate ${rank}`,
    description: "Synthetic day-discovery fixture, not a live venue.",
    source: "qloo",
    category: "culture",
    lat: 38.72,
    lng: -9.13,
    taste: { queryId, rank },
    practical: { hours: "unknown", cost: "unknown" },
    facts: {
      source: "qloo",
      retrievedAt: "2026-10-30T12:00:00Z",
      address: "Synthetic fixture address",
    },
  };
}
function deferred() {
  const requests: { url: string; init: RequestInit; resolve: (response: Response) => void }[] = [];
  const transport: DayDiscoveryTransport = (url, init) =>
    new Promise((resolve) => {
      requests.push({ url, init, resolve });
    });
  return { requests, transport };
}
function accessFor(
  trip = tripFixture(),
  dayId = "day-1",
  scope = "fixture-owner",
  radius = 8000,
): DayDiscoveryAccess {
  const prepared = prepareDayDiscovery(trip, dayId, scope, radius);
  return { context: prepared.context, active: true, enabled: true, blockedReason: prepared.error };
}
function response(places = [candidate()]) {
  return Response.json({ provider: "qloo", queryId: "synthetic-day-query", selected: places });
}

describe("day-scoped Qloo discovery", () => {
  test("construction, mount synchronization and unavailable inputs never call a provider", async () => {
    const fixture = tripFixture();
    const deferredRequest = deferred();
    let access = accessFor(fixture);
    const controller = new DayDiscoveryController(
      () => access,
      () => {},
      deferredRequest.transport,
    );
    controller.synchronize();
    expect(controller.getSnapshot().status).toBe("idle");
    expect(deferredRequest.requests).toHaveLength(0);
    for (const change of [{ active: false }, { enabled: false }]) {
      access = { ...accessFor(fixture), ...change };
      expect(await controller.find()).toBe(false);
    }
    const noFavorites = structuredClone(fixture);
    delete noFavorites.brief.tasteProfile;
    access = accessFor(noFavorites);
    expect(await controller.find()).toBe(false);
    expect(access.blockedReason).toContain("Confirm at least one");
    expect(prepareDayDiscovery(fixture, "unknown-day", "owner", 8000).context).toBeNull();
    expect(prepareDayDiscovery(fixture, "day-1", "owner", 8001).context).toBeNull();
    const unconfirmed = structuredClone(fixture);
    unconfirmed.brief.tasteProfile!.seeds[0]!.id = "not-a-provider-entity-id";
    expect(prepareDayDiscovery(unconfirmed, "day-1", "owner", 8000).context).toBeNull();
    expect(deferredRequest.requests).toHaveLength(0);
  });

  test("one explicit request sends only bounded confirmed inputs and leaves canonical trip evidence untouched", async () => {
    const trip = tripFixture();
    trip.places[0] = { ...candidate(3, "old-canonical-query"), id: trip.stops[0]!.placeId };
    const before = structuredClone(trip);
    const access = accessFor(trip);
    const deferredRequest = deferred();
    const controller = new DayDiscoveryController(
      () => access,
      () => {},
      deferredRequest.transport,
    );
    const pending = controller.find();
    const request = deferredRequest.requests[0]!;
    expect(request.url).toBe("/api/taste");
    expect(request.init.method).toBe("POST");
    expect(JSON.parse(String(request.init.body))).toEqual({
      entityIds: [favorite.id],
      destinationId: "lisbon",
      destination: access.context!.destination,
      radiusMetres: 8000,
      take: 20,
      categories: ["culture"],
      excludedIds: [],
    });
    expect(String(request.init.body)).not.toContain("fixture-owner");
    expect(String(request.init.body)).not.toContain(trip.id);
    expect(String(request.init.body)).not.toContain(favorite.name);
    expect(Object.isFrozen(access.context)).toBe(true);
    expect(Object.isFrozen(access.context!.destination)).toBe(true);
    const found = { ...candidate(17), id: trip.places[0]!.id };
    request.resolve(response([found]));
    expect(await pending).toBe(true);
    expect(controller.getSnapshot().candidates).toEqual([found]);
    expect(controller.getSnapshot().candidates[0]?.taste).toEqual({
      queryId: "synthetic-day-query",
      rank: 17,
    });
    expect(controller.getSnapshot().candidates[0]?.facts).toEqual(found.facts);
    expect(Object.isFrozen(controller.getSnapshot().binding)).toBe(true);
    expect(trip).toEqual(before);
    expect(controller.isCurrent(controller.getSnapshot().binding!)).toBe(true);
  });

  test("imported destination extensions stay private and mutations cannot change captured retry inputs", async () => {
    const original = tripFixture();
    const city = getTripDestination(original, original.brief.destinationId);
    if (!city) throw new Error("Synthetic fixture city was missing");
    const importedCity = {
      ...city,
      syntheticPrivateExtension: "Synthetic private imported note",
      syntheticNestedExtension: { note: "Synthetic nested note", values: ["private"] },
    };
    original.brief.destination = importedCity;
    const imported = parseStoredTrip(JSON.parse(JSON.stringify(original)));
    if (!imported?.brief.destination) throw new Error("Synthetic imported city was rejected");
    expect("syntheticPrivateExtension" in imported.brief.destination).toBe(true);
    const access = accessFor(imported);
    const context = access.context;
    if (!context) throw new Error("Synthetic discovery context was rejected");
    expect(context.destination).toEqual(city);
    expect(Object.keys(context.destination).sort()).toEqual(
      ["id", "name", "country", "lat", "lng", "timeZone"].sort(),
    );
    expect(Object.isFrozen(context.destination)).toBe(true);
    expect(context.requestBody).not.toContain("syntheticPrivateExtension");
    expect(context.requestBody).not.toContain("Synthetic private imported note");
    expect(context.requestBody).not.toContain("syntheticNestedExtension");

    const deferredRequest = deferred();
    const controller = new DayDiscoveryController(
      () => access,
      () => {},
      deferredRequest.transport,
    );
    const first = controller.find();
    const firstRequest = deferredRequest.requests[0];
    const capturedBody = firstRequest?.init.body;
    if (!firstRequest || typeof capturedBody !== "string")
      throw new Error("Synthetic Find did not capture a serialized request");
    controller.stop();
    imported.brief.destination.name = "Changed after Find";
    const nested = Reflect.get(imported.brief.destination, "syntheticNestedExtension") as {
      note: string;
      values: string[];
    };
    nested.note = "Changed private extension";
    nested.values.push("another private value");
    const seed = imported.brief.tasteProfile?.seeds[0];
    if (!seed) throw new Error("Synthetic imported favorite was missing");
    seed.id = "00000000-0000-4000-8000-000000000099";
    expect(context.destination).toEqual(city);
    expect(context.requestBody).toBe(capturedBody);
    const retry = controller.retry();
    const retryRequest = deferredRequest.requests[1];
    if (!retryRequest) throw new Error("Synthetic Retry did not start");
    expect(retryRequest.init.body).toBe(capturedBody);
    expect(JSON.parse(capturedBody).entityIds).toEqual([favorite.id]);
    firstRequest.resolve(response());
    expect(await first).toBe(false);
    retryRequest.resolve(response());
    expect(await retry).toBe(true);
    expect(deferredRequest.requests).toHaveLength(2);
  });

  test("the requested day resolves its actual route city, including supplied custom destinations", () => {
    const original = tripFixture();
    const custom = {
      id: "synthetic-custom-discovery",
      name: "Synthetic Custom City",
      country: "Fixture country",
      lat: 48,
      lng: 2,
      timeZone: "Europe/Paris",
    };
    // Open city days avoid moving the fixture's existing Lisbon visits into another city.
    original.stops = original.stops.filter((stop) => stop.dayId === "day-1");
    const result = applyTripCommand(original, {
      id: "day-discovery-route-fixture",
      baseVersion: original.version,
      operations: [
        {
          type: "set-route",
          route: {
            startDate: null,
            stays: [
              { id: "lisbon", destinationId: "lisbon", days: 1 },
              { id: "custom", destinationId: custom.id, destination: custom, days: 1 },
            ],
            transfers: [
              { id: "transfer", fromStayId: "lisbon", toStayId: "custom", mode: "train" },
            ],
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const prepared = prepareDayDiscovery(result.trip, "day-2", "owner", 50000);
    expect(prepared.destination).toEqual(custom);
    expect(JSON.parse(prepared.context!.requestBody)).toMatchObject({
      destinationId: custom.id,
      destination: custom,
      radiusMetres: 50000,
    });
  });

  test("responses retain query-local ranks/order but reject every damaged or ambiguous selected candidate", () => {
    const destination = accessFor().context!.destination;
    const ordered = [candidate(9), candidate(1), candidate(7)];
    expect(parseDayDiscoveryCandidates({ selected: ordered }, destination)).toEqual(ordered);
    expect(parseDayDiscoveryCandidates({ provider: "qloo", selected: [] }, destination)).toEqual(
      [],
    );
    const bad: unknown[] = [
      null,
      {},
      { selected: null },
      { provider: "other", selected: [candidate()] },
      { selected: [candidate(), candidate()] },
      { selected: [candidate(), { ...candidate(8), destinationId: "porto" }] },
      { selected: [{ ...candidate(), destinationId: undefined }] },
      { selected: [{ ...candidate(), source: "demo", taste: undefined }] },
      { selected: [{ ...candidate(), taste: undefined }] },
      { selected: [{ ...candidate(), taste: { queryId: "", rank: 7 } }] },
      { selected: [{ ...candidate(), taste: { queryId: "query", rank: 0 } }] },
      {
        selected: [
          { ...candidate(), taste: { queryId: "query", rank: Number.MAX_SAFE_INTEGER + 1 } },
        ],
      },
      { selected: [candidate(7), candidate(7, "synthetic-day-query", "different-place")] },
      { selected: [candidate(7), candidate(8, "different-query")] },
      { queryId: "wrong-response-query", selected: [candidate()] },
      { selected: Array.from({ length: 21 }, (_, index) => candidate(index + 1)) },
    ];
    for (const body of bad)
      expect(() => parseDayDiscoveryCandidates(body, destination)).toThrow("could not be verified");
  });

  test("Stop preserves exact retry inputs and ignores its late completion without disturbing the retry", async () => {
    const access = accessFor();
    const deferredRequest = deferred();
    const controller = new DayDiscoveryController(
      () => access,
      () => {},
      deferredRequest.transport,
    );
    const first = controller.find();
    expect(await controller.find()).toBe(false);
    const firstBinding = controller.getSnapshot().binding!;
    controller.stop();
    expect(deferredRequest.requests[0]!.init.signal?.aborted).toBe(true);
    expect(controller.getSnapshot().status).toBe("stopped");
    const retry = controller.retry();
    expect(deferredRequest.requests).toHaveLength(2);
    expect(deferredRequest.requests[1]!.init.body).toBe(deferredRequest.requests[0]!.init.body);
    expect(controller.getSnapshot().binding?.requestId).not.toBe(firstBinding.requestId);
    deferredRequest.requests[0]!.resolve(response([candidate(1)]));
    expect(await first).toBe(false);
    expect(controller.getSnapshot().status).toBe("loading");
    deferredRequest.requests[1]!.resolve(response());
    expect(await retry).toBe(true);
    expect(controller.getSnapshot().candidates).toEqual([candidate()]);
    expect(controller.isCurrent(firstBinding)).toBe(false);
    controller.clear();
    expect(controller.getSnapshot().candidates).toEqual([]);
    expect(await controller.retry()).toBe(false);
    expect(deferredRequest.requests).toHaveLength(2);
  });

  test("close, settings, owner, trip, version, day, city and radius changes abort and reject late output", async () => {
    const original = tripFixture();
    const changedTrip = structuredClone(original);
    changedTrip.id = "another-canonical-trip";
    const newer = structuredClone(original);
    newer.version++;
    const otherCity = createDemoTrip({ ...original.brief, destinationId: "porto" });
    otherCity.id = original.id;
    const contexts = [
      { ...accessFor(original), active: false },
      { ...accessFor(original), enabled: false },
      accessFor(original, "day-1", "another-owner"),
      accessFor(changedTrip),
      accessFor(newer),
      accessFor(original, "day-2"),
      accessFor(otherCity),
      accessFor(original, "day-1", "fixture-owner", 2000),
    ];
    for (const changed of contexts) {
      let access = accessFor(original);
      const deferredRequest = deferred();
      const controller = new DayDiscoveryController(
        () => access,
        () => {},
        deferredRequest.transport,
      );
      const pending = controller.find();
      const binding = controller.getSnapshot().binding!;
      access = changed;
      expect(controller.isCurrent(binding)).toBe(false);
      controller.synchronize();
      expect(deferredRequest.requests[0]!.init.signal?.aborted).toBe(true);
      deferredRequest.requests[0]!.resolve(response());
      expect(await pending).toBe(false);
      expect(controller.getSnapshot().candidates).toEqual([]);
      expect(await controller.retry()).toBe(false);
      expect(deferredRequest.requests).toHaveLength(1);
    }
  });

  test("late replies are rejected even before effect cancellation observes the new context", async () => {
    let access = accessFor();
    const deferredRequest = deferred();
    const controller = new DayDiscoveryController(
      () => access,
      () => {},
      deferredRequest.transport,
    );
    const pending = controller.find();
    access = { ...access, active: false };
    deferredRequest.requests[0]!.resolve(response());
    expect(await pending).toBe(false);
    expect(controller.getSnapshot().candidates).toEqual([]);
    controller.dispose();
    access = { ...access, active: true };
    controller.synchronize();
    expect(await controller.retry()).toBe(false);
  });

  test("provider errors, unreadable responses and oversized replies retain retry without exposing raw response text", async () => {
    const access = accessFor();
    const responses = [
      Response.json({ error: { message: "Synthetic provider interruption" } }, { status: 503 }),
      new Response("synthetic-private-unreadable-body"),
      new Response("x".repeat(4_000_001)),
      response([]),
    ];
    let calls = 0;
    const controller = new DayDiscoveryController(
      () => access,
      () => {},
      async () => responses[calls++]!,
    );
    expect(await controller.find()).toBe(false);
    expect(controller.getSnapshot().error).toBe("Synthetic provider interruption");
    expect(await controller.retry()).toBe(false);
    expect(controller.getSnapshot().error).not.toContain("synthetic-private-unreadable-body");
    expect(await controller.retry()).toBe(false);
    expect(controller.getSnapshot().error).toContain("too large");
    expect(await controller.retry()).toBe(true);
    expect(controller.getSnapshot().status).toBe("ready");
    expect(controller.getSnapshot().candidates).toEqual([]);
    expect(calls).toBe(4);
  });
});
