import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyTripCommand, createDemoTrip, DEFAULT_BRIEF, type Trip } from "@tastip/domain";
import { type Database, openDatabase } from "./database";
import { ServiceError } from "./service-error";
import { boundedPasswordDeriver, publicTripSnapshot, TripStore } from "./trip-store";

const resources: { store: TripStore; directory?: string }[] = [];
// Fast deterministic test double only. Production always uses bounded memory-hard scrypt.
const fakeDerive = async (password: string, salt: string) =>
  createHash("sha512").update(`${password}:${salt}`).digest();
function fixture(clock?: () => number, path = ":memory:") {
  const db = openDatabase(path);
  db.prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(
    "owner-a",
    "owner-a",
    "unused-test-double",
    0,
  );
  db.prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(
    "owner-b",
    "owner-b",
    "unused-test-double",
    0,
  );
  const store = new TripStore(db, clock, fakeDerive);
  resources.push({ store });
  return { db, store };
}
function updated(trip: Trip, commandId = "pin") {
  const result = applyTripCommand(trip, {
    id: commandId,
    baseVersion: trip.version,
    operations: [{ type: "pin-stop", stopId: trip.stops[0]!.id, pinned: true }],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.trip;
}
function errorCode(work: () => unknown) {
  try {
    work();
    return "accepted";
  } catch (error) {
    if (error instanceof ServiceError) return error.code;
    throw error;
  }
}
afterEach(() => {
  for (const resource of resources.splice(0)) {
    resource.store.close();
    if (resource.directory) rmSync(resource.directory, { recursive: true, force: true });
  }
});

describe("owned transactional trip persistence", () => {
  test("shared snapshots retain user-entered place names and pins with traveler provenance", () => {
    const { store } = fixture();
    const before = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
    const place = {
      id: "traveler:shared",
      name: "Own shared pin",
      destinationId: "lisbon",
      description: "User-entered pin",
      category: "outdoors" as const,
      source: "traveler" as const,
      lat: 38.72,
      lng: -9.14,
      practical: { hours: "unknown" as const, cost: "unknown" as const },
    };
    const result = applyTripCommand(before, {
      id: "shared-pin",
      baseVersion: 1,
      operations: [
        { type: "set-own-place", place },
        {
          type: "add-stop",
          stop: {
            id: "shared-pin-visit",
            placeId: place.id,
            dayId: "day-1",
            startTime: "15:30",
            durationMinutes: 60,
            pinned: false,
            timeLocked: false,
            note: "Private pin reminder",
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    store.save("owner-a", result.trip, null);
    expect(store.read("owner-a", result.trip.id).trip.places.at(-1)).toEqual(place);
    const link = store.share("owner-a", result.trip.id, 1);
    const shared = store.shared(link.token);
    expect(shared.places.find((item) => item.id === place.id)).toEqual(place);
    expect(shared.stops.find((stop) => stop.id === "shared-pin-visit")?.note).toBeUndefined();
    expect(shared.stops.find((stop) => stop.id === "shared-pin-visit")?.selection).toBeUndefined();
  });
  test("account lists and immutable shared snapshots keep the accepted trip name", () => {
    const { store } = fixture();
    const before = createDemoTrip(DEFAULT_BRIEF);
    const result = applyTripCommand(before, {
      id: "name-saved-trip",
      baseVersion: 1,
      operations: [{ type: "set-trip-title", title: "Lisbon, slowly" }],
    });
    if (!result.ok) throw new Error(result.error.message);
    store.save("owner-a", result.trip, null);
    expect(store.list("owner-a")[0]?.title).toBe("Lisbon, slowly");
    expect(store.read("owner-a", before.id).trip.title).toBe("Lisbon, slowly");
    const link = store.share("owner-a", before.id, 1);
    expect(store.shared(link.token).title).toBe("Lisbon, slowly");
    const renamed = applyTripCommand(result.trip, {
      id: "later-name",
      baseVersion: result.trip.version,
      operations: [{ type: "set-trip-title", title: "New private name" }],
    });
    if (!renamed.ok) throw new Error(renamed.error.message);
    store.save("owner-a", renamed.trip, 1);
    expect(store.shared(link.token).title).toBe("Lisbon, slowly");
  });
  test("traveler lodging keeps private details in account saves and only its name in shared copies", () => {
    const { store } = fixture();
    const before = createDemoTrip(DEFAULT_BRIEF);
    const result = applyTripCommand(before, {
      id: "private-lodging",
      baseVersion: 1,
      operations: [
        {
          type: "set-route",
          route: {
            startDate: "2028-02-28",
            stays: [{ id: "a", destinationId: "lisbon", days: 3 }],
            transfers: [],
          },
        },
        {
          type: "select-lodging",
          stayId: "a",
          candidate: {
            id: "manual",
            name: "Traveler stay fixture",
            destinationId: "lisbon",
            source: "traveler",
            address: "Private lodging address",
            website: "https://example.test/private-stay",
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    store.save("owner-a", result.trip, null);
    expect(store.read("owner-a", result.trip.id).trip.lodgings).toEqual(result.trip.lodgings);
    const link = store.share("owner-a", result.trip.id, 1);
    const shared = store.shared(link.token);
    expect(shared.lodgings?.[0]?.candidate).toEqual({
      id: "manual",
      name: "Traveler stay fixture",
      destinationId: "lisbon",
      source: "traveler",
    });
    expect(JSON.stringify(shared)).not.toContain("Private lodging address");
    expect(JSON.stringify(shared)).not.toContain("private-stay");
    expect(shared.commandLog).toEqual([]);
  });
  test("scopes reads, lists, saves, links and revocations to each owner", () => {
    const { store } = fixture();
    const trip = createDemoTrip(DEFAULT_BRIEF);
    expect(store.save("owner-a", trip, null)).toEqual({
      id: trip.id,
      revision: 1,
      replayed: false,
    });
    expect(store.list("owner-b")).toEqual([]);
    expect(errorCode(() => store.read("owner-b", trip.id))).toBe("TRIP_NOT_FOUND");
    expect(errorCode(() => store.share("owner-b", trip.id, 1))).toBe("TRIP_NOT_FOUND");
    expect(errorCode(() => store.shares("owner-b", trip.id))).toBe("TRIP_NOT_FOUND");
    const link = store.share("owner-a", trip.id, 1);
    expect(errorCode(() => store.revoke("owner-b", link.token))).toBe("SHARE_NOT_FOUND");
    expect(store.shared(link.token).id).toBe(trip.id);
    // A trip UUID is not a globally owned primary key; isolated accounts can import copies.
    expect(store.save("owner-b", trip, null).revision).toBe(1);
    expect(store.list("owner-a")).toHaveLength(1);
    expect(store.list("owner-a")[0]?.startDate).toBeNull();
    expect(store.list("owner-b")).toHaveLength(1);
  });
  test("replays exact saves, rejects stale revisions, divergent ancestry and domain rollback", () => {
    const { store } = fixture();
    const trip = createDemoTrip(DEFAULT_BRIEF);
    store.save("owner-a", trip, null);
    expect(store.save("owner-a", trip, null).replayed).toBe(true);
    const next = updated(trip);
    expect(store.save("owner-a", next, 1).revision).toBe(2);
    expect(store.save("owner-a", next, 1)).toEqual({ id: trip.id, revision: 2, replayed: true });
    expect(errorCode(() => store.save("owner-a", trip, 2))).toBe("SAVE_CONFLICT");
    const branch = updated(trip, "other-branch");
    expect(errorCode(() => store.save("owner-a", branch, 1))).toBe("SAVE_CONFLICT");
    expect(errorCode(() => store.save("owner-a", updated(branch, "branch-two"), 2))).toBe(
      "SAVE_CONFLICT",
    );
    expect(errorCode(() => store.share("owner-a", trip.id, 1))).toBe("SAVE_CONFLICT");
    expect(store.read("owner-a", trip.id).trip).toEqual(next);
    const fork = {
      ...structuredClone(branch),
      id: crypto.randomUUID(),
      version: 1,
      appliedCommandIds: [],
      commandLog: [],
    };
    expect(store.save("owner-a", fork, null).revision).toBe(1);
  });
  test("a failed update never mutates the stored payload", () => {
    const { store } = fixture();
    const trip = createDemoTrip(DEFAULT_BRIEF);
    store.save("owner-a", trip, null);
    const malformed = { ...trip, stops: [{ ...trip.stops[0], dayId: "missing" }] };
    expect(errorCode(() => store.save("owner-a", malformed, 1))).toBe("INVALID_TRIP");
    expect(store.read("owner-a", trip.id)).toEqual({ trip, revision: 1 });
  });
  test("share snapshots strip private preferences and history, survive reopen, revoke and expire", () => {
    let now = 1000;
    const { store, db } = fixture(() => now);
    const trip = createDemoTrip({
      ...DEFAULT_BRIEF,
      origin: "Private home",
      details: {
        request: "Private original request",
        travelers: { adults: 2, children: 0, infants: 0, pets: 1 },
        flexibleMonths: ["2027-04"],
      },
      budget: 1234,
      interests: ["Private interest"],
      tasteProfile: {
        seeds: [{ id: "private-seed", name: "Private favorite", type: "book" }],
        dayStyle: "Private style",
        categories: [],
        dietary: ["Private diet"],
      },
    });
    trip.media = [
      {
        id: "private-receipt",
        name: "Private receipt.pdf",
        kind: "file",
        purpose: "receipt",
        mimeType: "application/pdf",
        size: 1024,
        addedAt: "2027-03-01T00:00:00.000Z",
      },
      {
        id: "private-media-link",
        name: "Private media link",
        kind: "link",
        purpose: "media",
        url: "https://example.com/private-inspiration",
        addedAt: "2027-03-01T00:00:00.000Z",
      },
    ];
    trip.days[0]!.note = "Private note";
    trip.stops[0]!.note = "Private visit reminder";
    trip.costs = [
      {
        id: "private-cost",
        label: "Private cost label",
        category: "lodging",
        currency: "EUR",
        unitAmountMinor: 12345,
        quantity: 2,
        appliesTo: "party",
        source: "traveler",
      },
    ];
    trip.stops[0]!.feedback = "less";
    const candidate = trip.places[0]!;
    candidate.source = "qloo";
    candidate.taste = { queryId: "query-provenance", rank: 1, score: 0.97 };
    trip.stops[0]!.selection = { queryId: "selection-provenance", rank: 4, score: 0.81 };
    store.save("owner-a", updated(trip), null);
    expect(store.read("owner-a", trip.id).trip.costs).toEqual(trip.costs);
    expect(store.read("owner-a", trip.id).trip.stops[0]?.note).toBe("Private visit reminder");
    const link = store.share("owner-a", trip.id, 1);
    const shared = store.shared(link.token);
    const serialized = JSON.stringify(shared);
    expect(shared.media).toBeUndefined();
    expect(shared.brief.details).toBeUndefined();
    for (const secret of [
      "Private original request",
      "Private receipt.pdf",
      "Private media link",
      "private-inspiration",
      "Private home",
      "Private interest",
      "Private favorite",
      "Private style",
      "Private diet",
      "Private note",
      "Private visit reminder",
      "Private cost label",
      "12345",
      "0.97",
      "0.81",
    ])
      expect(serialized).not.toContain(secret);
    expect(shared.brief.budget).toBeNull();
    expect(shared.costs).toBeUndefined();
    expect(shared.brief.origin).toBe("");
    expect(shared.commandLog).toEqual([]);
    expect(shared.appliedCommandIds).toEqual([]);
    expect(shared.stops[0]?.feedback).toBeUndefined();
    expect(shared.stops[0]?.note).toBeUndefined();
    expect(shared.places[0]?.taste?.queryId).toBe("query-provenance");
    const reopened = new TripStore(db, () => now, fakeDerive);
    expect(reopened.shares("owner-a", trip.id)[0]).toEqual({ ...link, revoked: false });
    // Snapshot content does not change when its owner's trip advances.
    const saved = store.read("owner-a", trip.id);
    store.save("owner-a", updated(saved.trip, "later"), saved.revision);
    expect(store.shared(link.token)).toEqual(shared);
    store.revoke("owner-a", link.token);
    expect(errorCode(() => store.shared(link.token))).toBe("SHARE_NOT_FOUND");
    expect(store.shares("owner-a", trip.id)[0]?.revoked).toBe(true);
    const expiring = store.share("owner-a", trip.id, 2);
    now = expiring.expiresAt;
    expect(errorCode(() => store.shared(expiring.token))).toBe("SHARE_NOT_FOUND");
    expect(errorCode(() => store.shared("bad"))).toBe("SHARE_NOT_FOUND");
  });
  test("persisted SQLite rows survive database close and reopen with restricted file permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "tastip-store-"));
    const path = join(directory, "trips.sqlite");
    const { store } = fixture(undefined, path);
    const trip = createDemoTrip(DEFAULT_BRIEF);
    store.save("owner-a", trip, null);
    const link = store.share("owner-a", trip.id, 1);
    store.close();
    resources.splice(
      resources.findIndex((entry) => entry.store === store),
      1,
    );
    const reopened = new TripStore(openDatabase(path), undefined, fakeDerive);
    resources.push({ store: reopened, directory });
    expect(reopened.read("owner-a", trip.id).trip).toEqual(trip);
    expect(reopened.shared(link.token).id).toBe(trip.id);
    expect(reopened.shares("owner-a", trip.id)).toHaveLength(1);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
  test("persisted quota windows reject overflow and reset exactly at expiry", () => {
    let now = 500;
    const { store } = fixture(() => now);
    store.consume("bucket", 2, 1000);
    store.consume("bucket", 2, 1000);
    expect(errorCode(() => store.consume("bucket", 2, 1000))).toBe("RATE_LIMITED");
    now = 1499;
    expect(errorCode(() => store.consume("bucket", 2, 1000))).toBe("RATE_LIMITED");
    now = 1500;
    expect(errorCode(() => store.consume("bucket", 2, 1000))).toBe("accepted");
    expect(errorCode(() => store.consume("invalid", -1, 1000))).toBe("INVALID_QUOTA");
  });
});

describe("sessions and bounded password hashing", () => {
  test("limits concurrent work without queuing and releases capacity after success and failure", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let active = 0,
      peak = 0;
    const derive = boundedPasswordDeriver(async () => {
      active++;
      peak = Math.max(peak, active);
      await gate;
      active--;
      return Buffer.alloc(64);
    });
    const first = derive("a", "salt");
    const second = derive("b", "salt");
    await expect(derive("c", "salt")).rejects.toMatchObject({ code: "ACCOUNT_BUSY", status: 429 });
    release?.();
    await Promise.all([first, second]);
    expect(peak).toBe(2);
    await expect(derive("d", "salt")).resolves.toHaveLength(64);
    const failing = boundedPasswordDeriver(async () => {
      throw new Error("hash failed");
    }, 1);
    await expect(failing("a", "s")).rejects.toThrow("hash failed");
    await expect(failing("b", "s")).rejects.toThrow("hash failed");
  });
  test("registers normalized users, verifies passwords, hashes tokens and invalidates logout/expiry", async () => {
    let now = 1000;
    const { store, db } = fixture(() => now);
    const registered = await store.register("  Alice.Test  ", "long-test-password");
    expect(registered.account.username).toBe("alice.test");
    expect(store.account(registered.token)).toEqual(registered.account);
    const session = db
      .prepare("SELECT token_hash FROM sessions WHERE user_id=?")
      .get(registered.account.id) as { token_hash: string };
    expect(session.token_hash).not.toBe(registered.token);
    expect(session.token_hash).toHaveLength(64);
    await expect(store.register("alice.test", "another-test-password")).rejects.toMatchObject({
      code: "ACCOUNT_UNAVAILABLE",
    });
    await expect(store.login("alice.test", "incorrect-password")).rejects.toMatchObject({
      code: "INVALID_LOGIN",
    });
    await expect(store.login("unknown-user", "incorrect-password")).rejects.toMatchObject({
      code: "INVALID_LOGIN",
    });
    const signedIn = await store.login("ALICE.TEST", "long-test-password");
    expect(signedIn.account).toEqual(registered.account);
    store.logout(signedIn.token);
    expect(store.account(signedIn.token)).toBeNull();
    now += 7 * 24 * 60 * 60 * 1000;
    expect(store.account(registered.token)).toBeNull();
    expect(store.account("malformed")).toBeNull();
  });
  test("uses production scrypt format and authenticates a real memory-hard hash", async () => {
    const store = new TripStore(openDatabase(":memory:"));
    resources.push({ store });
    const registered = await store.register("real-scrypt-test", "a-real-test-password");
    const signedIn = await store.login("real-scrypt-test", "a-real-test-password");
    expect(signedIn.account).toEqual(registered.account);
  });
});

test("registration rolls back its account if session persistence fails", async () => {
  const { db } = fixture();
  const failing: Database = {
    exec: (sql) => db.exec(sql),
    close: () => {},
    prepare: (sql) => {
      if (sql.startsWith("INSERT INTO sessions"))
        throw new Error("synthetic session persistence failure");
      return db.prepare(sql);
    },
  };
  const store = new TripStore(failing, undefined, fakeDerive);
  await expect(store.register("atomic-user", "test-password-123")).rejects.toThrow(
    "synthetic session",
  );
  expect(db.prepare("SELECT id FROM accounts WHERE username=?").get("atomic-user")).toBeUndefined();
});

test("active share cap releases after revocation or expiry", () => {
  let now = 1000;
  const { store } = fixture(() => now);
  const trip = createDemoTrip(DEFAULT_BRIEF);
  store.save("owner-a", trip, null);
  const links = [];
  for (let index = 0; index < 50; index++) {
    links.push(store.share("owner-a", trip.id, 1));
    now += 60 * 60 * 1000;
  }
  expect(errorCode(() => store.share("owner-a", trip.id, 1))).toBe("SHARE_LIMIT");
  store.revoke("owner-a", links[0]!.token);
  expect(store.share("owner-a", trip.id, 1).token).toHaveLength(43);
  now += 30 * 24 * 60 * 60 * 1000;
  expect(store.share("owner-a", trip.id, 1).token).toHaveLength(43);
});

test("owner listing never hides an old active link behind recent revoked history", () => {
  let now = 1000;
  const { store } = fixture(() => now);
  const trip = createDemoTrip(DEFAULT_BRIEF);
  store.save("owner-a", trip, null);
  const original = store.share("owner-a", trip.id, 1);
  for (let index = 0; index < 105; index++) {
    now += 60 * 60 * 1000;
    const link = store.share("owner-a", trip.id, 1);
    store.revoke("owner-a", link.token);
  }
  const listing = store.shares("owner-a", trip.id);
  expect(listing).toHaveLength(100);
  expect(listing[0]?.token).toBe(original.token);
  expect(listing[0]?.revoked).toBe(false);
  expect(store.shared(original.token).id).toBe(trip.id);
});
