import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import {
  getTripTitle,
  parseStoredTrip,
  parseTasteProfile,
  type TasteProfile,
  type Trip,
} from "@tastip/domain";
import {
  backupConversations,
  type ConversationBackup,
} from "../features/planner/lib/conversation-backup";
import { parseConversations } from "../features/planner/lib/conversations";
import { type Database, databasePath, openDatabase } from "./database";
import { ServiceError } from "./service-error";

type Row = Record<string, string | number | null>;
const row = (value: unknown) => (value && typeof value === "object" ? (value as Row) : undefined);
export type Account = { id: string; username: string };
export type SavedTasteProfile = {
  profile: TasteProfile | null;
  revision: number;
  updatedAt: number | null;
};
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const SHARE_MS = 30 * 24 * 60 * 60 * 1000;
const scryptOptions = { N: 131072, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
type PasswordDeriver = (password: string, salt: string) => Promise<Buffer>;
const scryptPassword: PasswordDeriver = (password, salt) =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, 64, scryptOptions, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  );

/** No unbounded thread-pool queue: each process admits at most two memory-heavy KDF jobs. */
export function boundedPasswordDeriver(
  derive: PasswordDeriver = scryptPassword,
  capacity = 2,
): PasswordDeriver {
  if (!Number.isSafeInteger(capacity) || capacity < 1 || capacity > 2)
    throw new Error("Password derivation capacity must be one or two.");
  let active = 0;
  return async (password, salt) => {
    if (active >= capacity)
      throw new ServiceError("ACCOUNT_BUSY", "Sign-in is busy. Please try again in a moment.", 429);
    active++;
    try {
      return await derive(password, salt);
    } finally {
      active--;
    }
  };
}
const derivePassword = boundedPasswordDeriver();
function parsePayload(payload: unknown) {
  try {
    return parseStoredTrip(JSON.parse(String(payload)));
  } catch {
    return null;
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function samePlan(left: Trip, right: Trip) {
  const { commandLog: _leftLog, updatedAt: _leftTime, ...before } = left;
  const { commandLog: _rightLog, updatedAt: _rightTime, ...after } = right;
  return canonical(before) === canonical(after);
}
function descendsFrom(trip: Trip, previous: Trip) {
  return (
    trip.version > previous.version &&
    trip.appliedCommandIds
      .slice(0, previous.appliedCommandIds.length)
      .every((id, index) => id === previous.appliedCommandIds[index]) &&
    trip.appliedCommandIds.length >= previous.appliedCommandIds.length &&
    Boolean(
      trip.commandLog?.some(
        (entry) => entry.beforeVersion === previous.version && samePlan(entry.before, previous),
      ),
    )
  );
}

/** An explicit read-only snapshot: preferences and edit history never leave the owner's account. */
export function publicTripSnapshot(trip: Trip): Trip {
  const snapshot = structuredClone(trip);
  snapshot.version = 1;
  snapshot.appliedCommandIds = [];
  snapshot.commandLog = [];
  snapshot.brief.origin = "";
  delete snapshot.brief.originDestination;
  delete snapshot.brief.tasteProfile;
  delete snapshot.brief.details;
  delete snapshot.media;
  snapshot.brief.budget = null;
  delete snapshot.costs;
  snapshot.brief.interests = [];
  const scheduled = new Set(snapshot.stops.map((stop) => stop.placeId));
  snapshot.places = snapshot.places.filter((place) => scheduled.has(place.id));
  for (const choice of snapshot.lodgings ?? []) {
    if (choice.candidate.source === "traveler") {
      const { id, name, destinationId, source } = choice.candidate;
      choice.candidate = { id, name, destinationId, source };
    }
  }
  for (const day of snapshot.days) delete day.note;
  for (const place of snapshot.places) if (place.taste) delete place.taste.score;
  for (const stop of snapshot.stops) {
    delete stop.feedback;
    delete stop.note;
    if (stop.selection) delete stop.selection.score;
  }
  // Query IDs and original ranks remain as nonsensitive provenance required by canonical copies.
  const parsed = parseStoredTrip(snapshot);
  if (!parsed)
    throw new ServiceError(
      "SHARE_UNAVAILABLE",
      "This trip could not be prepared for sharing.",
      500,
    );
  return parsed;
}

/** One transactional persistence boundary, with ownership on every private query. */
export class TripStore {
  constructor(
    private readonly db: Database,
    private readonly now = Date.now,
    private readonly derive: PasswordDeriver = derivePassword,
  ) {}
  private transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  consume(bucket: string, limit: number, windowMs: number) {
    if (
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      !Number.isSafeInteger(windowMs) ||
      windowMs < 1
    )
      throw new ServiceError("INVALID_QUOTA", "Request limits are not configured correctly.", 500);
    const now = this.now();
    return this.transaction(() => {
      this.db.prepare("DELETE FROM rate_buckets WHERE expires_at <= ?").run(now);
      const existing = row(
        this.db.prepare("SELECT count FROM rate_buckets WHERE bucket=?").get(bucket),
      );
      if (Number(existing?.count ?? 0) >= limit)
        throw new ServiceError(
          "RATE_LIMITED",
          "Too many requests. Please wait before trying again.",
          429,
        );
      this.db
        .prepare(
          "INSERT INTO rate_buckets(bucket,count,expires_at) VALUES(?,1,?) ON CONFLICT(bucket) DO UPDATE SET count=count+1",
        )
        .run(bucket, now + windowMs);
    });
  }
  async register(username: string, password: string): Promise<{ account: Account; token: string }> {
    const normalized = username.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized) ||
      password.length < 10 ||
      password.length > 128
    )
      throw new ServiceError(
        "INVALID_ACCOUNT",
        "Use a 3–32 character username and a password of 10–128 characters.",
      );
    this.consume("register:global", 20, 60 * 60 * 1000);
    const salt = randomBytes(24).toString("hex");
    const passwordHash = `scrypt:${salt}:${(await this.derive(password, salt)).toString("hex")}`;
    const account = { id: randomUUID(), username: normalized };
    return this.transaction(() => {
      if (this.db.prepare("SELECT id FROM accounts WHERE username=?").get(normalized))
        throw new ServiceError(
          "ACCOUNT_UNAVAILABLE",
          "That username is unavailable. Choose another.",
          409,
        );
      this.db
        .prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)")
        .run(account.id, account.username, passwordHash, this.now());
      return { account, token: this.newSession(account.id) };
    });
  }
  async login(username: string, password: string): Promise<{ account: Account; token: string }> {
    const normalized = username.trim().toLowerCase();
    if (
      !/^[a-z0-9][a-z0-9._-]{2,31}$/.test(normalized) ||
      password.length > 128 ||
      !password.length
    )
      throw new ServiceError("INVALID_LOGIN", "The username or password is incorrect.", 401);
    this.consume(`login:${normalized}`, 8, 10 * 60 * 1000);
    this.consume("login:global", 80, 10 * 60 * 1000);
    const account = row(
      this.db
        .prepare("SELECT id,username,password_hash FROM accounts WHERE username=?")
        .get(normalized),
    );
    const hash =
      typeof account?.password_hash === "string"
        ? account.password_hash
        : `scrypt:${"0".repeat(48)}:${"0".repeat(128)}`;
    const [, salt = "", expected = ""] = hash.split(":");
    const actual = await this.derive(password, salt);
    const wanted = Buffer.from(expected, "hex");
    if (!account || wanted.length !== actual.length || !timingSafeEqual(wanted, actual))
      throw new ServiceError("INVALID_LOGIN", "The username or password is incorrect.", 401);
    const identity = { id: String(account.id), username: String(account.username) };
    return this.transaction(() => {
      this.db.prepare("DELETE FROM rate_buckets WHERE bucket=?").run(`login:${normalized}`);
      return { account: identity, token: this.newSession(identity.id) };
    });
  }
  private newSession(userId: string) {
    const token = randomBytes(32).toString("base64url");
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(this.now());
    // Keep session rows bounded without exposing or storing plaintext bearer tokens.
    this.db
      .prepare(
        "DELETE FROM sessions WHERE user_id=? AND token_hash NOT IN (SELECT token_hash FROM sessions WHERE user_id=? ORDER BY expires_at DESC LIMIT 9)",
      )
      .run(userId, userId);
    this.db
      .prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
      .run(digest(token), userId, this.now() + SESSION_MS);
    return token;
  }
  account(token: string | undefined): Account | null {
    if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const result = row(
      this.db
        .prepare(
          "SELECT accounts.id,accounts.username FROM sessions JOIN accounts ON accounts.id=sessions.user_id WHERE token_hash=? AND expires_at>?",
        )
        .get(digest(token), this.now()),
    );
    return result ? { id: String(result.id), username: String(result.username) } : null;
  }
  logout(token: string | undefined) {
    if (token && /^[A-Za-z0-9_-]{43}$/.test(token))
      this.db.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(token));
  }
  conversationBackup(owner: string): ConversationBackup {
    const result = row(
      this.db
        .prepare("SELECT payload,revision,updated_at FROM conversation_backups WHERE owner_id=?")
        .get(owner),
    );
    if (!result) return { conversations: null, revision: 0, updatedAt: null };
    const conversations =
      result.payload === null ? null : parseConversations(String(result.payload));
    if (result.payload !== null && !conversations)
      throw new ServiceError(
        "CHAT_BACKUP_UNAVAILABLE",
        "Your chat backup could not be read. The saved copy has been kept.",
        500,
      );
    return {
      conversations,
      revision: Number(result.revision),
      updatedAt: Number(result.updated_at),
    };
  }
  saveConversationBackup(
    owner: string,
    value: unknown,
    expectedRevision: number,
  ): ConversationBackup {
    const parsed = value === null ? null : parseConversations(JSON.stringify(value) ?? "");
    if (
      (value !== null && !parsed) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    )
      throw new ServiceError(
        "INVALID_CHAT_BACKUP",
        "Choose a valid chat history of at most 50 chats and 100 messages per chat.",
      );
    const conversations = parsed ? backupConversations(parsed) : null;
    const payload = conversations === null ? null : JSON.stringify(conversations);
    if (payload !== null && Buffer.byteLength(payload, "utf8") > 4_000_000)
      throw new ServiceError(
        "CHAT_BACKUP_TOO_LARGE",
        "Your chat backup exceeds the 4 MB limit.",
        413,
      );
    return this.transaction(() => {
      const previous = this.conversationBackup(owner);
      if (previous.revision !== expectedRevision)
        throw new ServiceError(
          "CHAT_BACKUP_CONFLICT",
          "Your account backup changed on another device. Refresh and review it before saving again.",
          409,
        );
      const revision = previous.revision + 1;
      const updatedAt = this.now();
      this.db
        .prepare(
          "INSERT INTO conversation_backups(owner_id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at",
        )
        .run(owner, payload, revision, updatedAt);
      return { conversations, revision, updatedAt };
    });
  }
  tasteProfile(owner: string): SavedTasteProfile {
    const result = row(
      this.db
        .prepare("SELECT profile,revision,updated_at FROM taste_profiles WHERE owner_id=?")
        .get(owner),
    );
    if (!result) return { profile: null, revision: 0, updatedAt: null };
    let profile: TasteProfile | null = null;
    if (result.profile !== null) {
      try {
        profile = parseTasteProfile(JSON.parse(String(result.profile)));
      } catch {
        /* Reject corrupt storage below. */
      }
      if (!profile)
        throw new ServiceError("PROFILE_UNAVAILABLE", "Saved preferences could not be read.", 500);
    }
    return { profile, revision: Number(result.revision), updatedAt: Number(result.updated_at) };
  }
  saveTasteProfile(owner: string, value: unknown, expectedRevision: number): SavedTasteProfile {
    const profile = value === null ? null : parseTasteProfile(value);
    if (
      (value !== null && !profile) ||
      !Number.isSafeInteger(expectedRevision) ||
      expectedRevision < 0
    )
      throw new ServiceError("INVALID_PROFILE", "Choose valid, confirmed travel preferences.");
    return this.transaction(() => {
      const previous = this.tasteProfile(owner);
      if (previous.revision !== expectedRevision)
        throw new ServiceError(
          "PROFILE_CONFLICT",
          "Saved preferences changed in another tab. Reload them before saving again.",
          409,
        );
      const revision = previous.revision + 1;
      const updatedAt = this.now();
      // A cleared row retains its revision, so an old tab cannot resurrect forgotten preferences.
      this.db
        .prepare(
          "INSERT INTO taste_profiles(owner_id,profile,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET profile=excluded.profile,revision=excluded.revision,updated_at=excluded.updated_at",
        )
        .run(owner, profile ? JSON.stringify(profile) : null, revision, updatedAt);
      return { profile, revision, updatedAt };
    });
  }
  list(owner: string) {
    return this.db
      .prepare(
        "SELECT trip_id,payload,revision,updated_at FROM trips WHERE owner_id=? ORDER BY updated_at DESC LIMIT 50",
      )
      .all(owner)
      .flatMap((value) => {
        const result = row(value);
        if (!result) return [];
        const trip = parsePayload(result.payload);
        if (!trip) return [];
        return [
          {
            id: trip.id,
            title: getTripTitle(trip),
            days: trip.days.length,
            startDate: trip.days[0]?.date ?? null,
            revision: Number(result.revision),
            updatedAt: Number(result.updated_at),
          },
        ];
      });
  }
  read(owner: string, id: string) {
    const result = row(
      this.db
        .prepare("SELECT payload,revision FROM trips WHERE owner_id=? AND trip_id=?")
        .get(owner, id),
    );
    if (!result) throw new ServiceError("TRIP_NOT_FOUND", "This saved trip is unavailable.", 404);
    const trip = parsePayload(result.payload);
    if (!trip)
      throw new ServiceError("TRIP_UNAVAILABLE", "This saved trip could not be validated.", 500);
    return { trip, revision: Number(result.revision) };
  }
  save(owner: string, value: unknown, expectedRevision: number | null) {
    const trip = parseStoredTrip(value);
    if (!trip)
      throw new ServiceError(
        "INVALID_TRIP",
        "This trip could not be validated. Your server copy is unchanged.",
      );
    const payload = JSON.stringify(trip);
    if (Buffer.byteLength(payload) > 4 * 1024 * 1024)
      throw new ServiceError(
        "TRIP_TOO_LARGE",
        "This trip is too large to save. Download a backup first.",
        413,
      );
    if (
      expectedRevision !== null &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
    )
      throw new ServiceError("INVALID_REVISION", "Choose a valid saved revision.");
    return this.transaction(() => {
      const existing = row(
        this.db
          .prepare("SELECT payload,revision FROM trips WHERE owner_id=? AND trip_id=?")
          .get(owner, trip.id),
      );
      if (existing && String(existing.payload) === payload)
        return { id: trip.id, revision: Number(existing.revision), replayed: true };
      if (
        (existing && Number(existing.revision) !== expectedRevision) ||
        (!existing && expectedRevision !== null)
      )
        throw new ServiceError(
          "SAVE_CONFLICT",
          "The server trip changed. Open its latest version or keep your current draft as a backup before replacing it.",
          409,
        );
      if (existing) {
        const previous = parsePayload(existing.payload);
        if (!previous || !descendsFrom(trip, previous))
          throw new ServiceError(
            "SAVE_CONFLICT",
            "This draft does not extend the saved trip. Reopen its latest version, or make a new trip copy to keep this branch.",
            409,
          );
      }
      if (
        !existing &&
        Number(
          row(this.db.prepare("SELECT count(*) AS total FROM trips WHERE owner_id=?").get(owner))
            ?.total ?? 0,
        ) >= 50
      )
        throw new ServiceError(
          "TRIP_LIMIT",
          "This account supports up to 50 saved trips. Download a backup before removing an old one.",
          409,
        );
      const revision = Number(existing?.revision ?? 0) + 1;
      this.db
        .prepare(
          "INSERT INTO trips(owner_id,trip_id,payload,revision,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(owner_id,trip_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at",
        )
        .run(owner, trip.id, payload, revision, this.now());
      return { id: trip.id, revision, replayed: false };
    });
  }
  share(owner: string, id: string, expectedRevision: number) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
      throw new ServiceError("INVALID_REVISION", "Save this draft before creating its share link.");
    this.consume(`share:${owner}`, 20, 60 * 60 * 1000);
    return this.transaction(() => {
      const { trip, revision } = this.read(owner, id);
      if (revision !== expectedRevision)
        throw new ServiceError(
          "SAVE_CONFLICT",
          "The saved trip changed. Save or reopen its latest version before sharing.",
          409,
        );
      const active = row(
        this.db
          .prepare(
            "SELECT count(*) AS total FROM shares WHERE owner_id=? AND trip_id=? AND revoked=0 AND expires_at>?",
          )
          .get(owner, id, this.now()),
      );
      if (Number(active?.total ?? 0) >= 50)
        throw new ServiceError(
          "SHARE_LIMIT",
          "This trip already has 50 active links. Revoke one before creating another.",
          409,
        );
      const snapshot = publicTripSnapshot(trip);
      const token = randomBytes(32).toString("base64url");
      const createdAt = this.now();
      const expiresAt = createdAt + SHARE_MS;
      this.db
        .prepare(
          "INSERT INTO shares(token,owner_id,trip_id,payload,created_at,expires_at) VALUES(?,?,?,?,?,?)",
        )
        .run(token, owner, id, JSON.stringify(snapshot), createdAt, expiresAt);
      return { path: `/share/${token}`, token, createdAt, expiresAt };
    });
  }
  shares(owner: string, id: string) {
    this.read(owner, id);
    return this.db
      .prepare(
        "SELECT token,created_at,expires_at,revoked FROM shares WHERE owner_id=? AND trip_id=? ORDER BY CASE WHEN revoked=0 AND expires_at>? THEN 0 ELSE 1 END,created_at DESC LIMIT 100",
      )
      .all(owner, id, this.now())
      .flatMap((value) => {
        const item = row(value);
        if (!item) return [];
        return [
          {
            token: String(item.token),
            path: `/share/${item.token}`,
            createdAt: Number(item.created_at),
            expiresAt: Number(item.expires_at),
            revoked: Boolean(item.revoked),
          },
        ];
      });
  }
  shared(token: string) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw new ServiceError("SHARE_NOT_FOUND", "This shared trip is unavailable.", 404);
    const result = row(
      this.db
        .prepare("SELECT payload FROM shares WHERE token=? AND revoked=0 AND expires_at>?")
        .get(token, this.now()),
    );
    const trip = result ? parsePayload(result.payload) : null;
    if (!trip)
      throw new ServiceError("SHARE_NOT_FOUND", "This shared trip is unavailable or expired.", 404);
    return trip;
  }
  revoke(owner: string, token: string) {
    const result = row(
      this.db.prepare("SELECT token FROM shares WHERE owner_id=? AND token=?").get(owner, token),
    );
    if (!result) throw new ServiceError("SHARE_NOT_FOUND", "This share link is unavailable.", 404);
    this.db.prepare("UPDATE shares SET revoked=1 WHERE owner_id=? AND token=?").run(owner, token);
  }
  close() {
    this.db.close();
  }
}
let activeStore: TripStore | undefined;
export function getTripStore() {
  activeStore ??= new TripStore(openDatabase(databasePath()));
  return activeStore;
}
