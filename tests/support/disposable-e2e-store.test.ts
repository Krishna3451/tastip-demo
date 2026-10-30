import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { openDatabase } from "../../apps/web/src/server/database";
import { TripStore } from "../../apps/web/src/server/trip-store";
import { prepareDisposableE2EStore, resetE2ERegistrationQuota } from "./disposable-e2e-store";

const origin = "http://127.0.0.1:3194";
const cleanup = new Set<string>();
afterEach(() => {
  for (const path of cleanup) rmSync(path, { recursive: true, force: true });
  cleanup.clear();
});
function store() {
  const env: Record<string, string | undefined> = {};
  const path = prepareDisposableE2EStore(origin, env);
  cleanup.add(path);
  return { path, env };
}
function seed(path: string) {
  const file = join(path, "tastip.sqlite");
  const database = new DatabaseSync(file);
  chmodSync(file, 0o600);
  database.exec(
    "CREATE TABLE rate_buckets(bucket TEXT PRIMARY KEY,count INTEGER,expires_at INTEGER); CREATE TABLE synthetic_private(id TEXT PRIMARY KEY,value TEXT);",
  );
  database.exec(
    "INSERT INTO rate_buckets VALUES('register:global',20,9999999999999),('login:global',7,9999999999999),('provider:synthetic',3,9999999999999); INSERT INTO synthetic_private VALUES('fixture','preserve this synthetic private value');",
  );
  database.close();
  return file;
}

test("a run marker survives worker config reload and cleanup changes only the registration bucket", () => {
  const { path, env } = store();
  expect(prepareDisposableE2EStore(origin, env)).toBe(path);
  const file = seed(path);
  resetE2ERegistrationQuota(origin, env);
  const database = new DatabaseSync(file, { readOnly: true });
  try {
    expect(database.prepare("SELECT * FROM rate_buckets ORDER BY bucket").all()).toEqual([
      { bucket: "login:global", count: 7, expires_at: 9999999999999 },
      { bucket: "provider:synthetic", count: 3, expires_at: 9999999999999 },
    ]);
    expect(database.prepare("SELECT value FROM synthetic_private").get()).toEqual({
      value: "preserve this synthetic private value",
    });
  } finally {
    database.close();
  }
});

test("a clean store without an app database does not create one during quota cleanup", () => {
  const { path, env } = store();
  resetE2ERegistrationQuota(origin, env);
  expect(existsSync(join(path, "tastip.sqlite"))).toBe(false);
});

test("existing operator data is never adopted or modified as a disposable store", () => {
  const path = mkdtempSync(join(tmpdir(), "synthetic-existing-store-"));
  cleanup.add(path);
  writeFileSync(join(path, "canary"), "synthetic existing bytes", { mode: 0o600 });
  const env = { TASTIP_E2E_DATA_DIR: path };
  expect(() => prepareDisposableE2EStore(origin, env)).toThrow();
  expect(() => resetE2ERegistrationQuota(origin, env)).toThrow();
  expect(readFileSync(join(path, "canary"), "utf8")).toBe("synthetic existing bytes");
});

test("reused servers, wrong run IDs and other origins cannot authorize cleanup", () => {
  const { env } = store();
  expect(() =>
    resetE2ERegistrationQuota(origin, { ...env, TASTIP_E2E_REUSE_SERVER: "1" }),
  ).toThrow();
  expect(() =>
    resetE2ERegistrationQuota(origin, { ...env, TASTIP_E2E_STORE_ID: "wrong-run" }),
  ).toThrow();
  expect(() => resetE2ERegistrationQuota("http://127.0.0.1:3000", env)).toThrow();
  expect(() => prepareDisposableE2EStore("https://foreign.example", {})).toThrow();
});

test("symlinked database and marker files are rejected without touching their targets", () => {
  const first = store();
  const target = store();
  const targetFile = seed(target.path);
  symlinkSync(targetFile, join(first.path, "tastip.sqlite"));
  expect(() => resetE2ERegistrationQuota(origin, first.env)).toThrow();
  const marker = join(first.path, ".tastip-e2e-disposable.json");
  rmSync(marker);
  symlinkSync(join(target.path, ".tastip-e2e-disposable.json"), marker);
  expect(() => resetE2ERegistrationQuota(origin, first.env)).toThrow();
  const database = new DatabaseSync(targetFile, { readOnly: true });
  try {
    expect(
      database.prepare("SELECT count FROM rate_buckets WHERE bucket='register:global'").get(),
    ).toEqual({ count: 20 });
  } finally {
    database.close();
  }
});

test("unmarked or nonprivate directories cannot authorize a quota write", () => {
  const { path, env } = store();
  chmodSync(path, 0o755);
  expect(() => resetE2ERegistrationQuota(origin, env)).toThrow();
  chmodSync(path, 0o700);
  rmSync(join(path, ".tastip-e2e-disposable.json"));
  expect(() => resetE2ERegistrationQuota(origin, env)).toThrow();
});

test("production registration still rejects account21 until this marked fixture alone is reset", async () => {
  const { path, env } = store();
  const database = openDatabase(join(path, "tastip.sqlite"));
  const accounts = new TripStore(database, Date.now, async () => Buffer.alloc(64));
  try {
    for (let index = 0; index < 20; index++)
      await accounts.register(`synthetic_${index}`, "Synthetic-test-password");
    await expect(
      accounts.register("synthetic_21", "Synthetic-test-password"),
    ).rejects.toMatchObject({
      code: "RATE_LIMITED",
      status: 429,
    });
    resetE2ERegistrationQuota(origin, env);
    await expect(
      accounts.register("synthetic_21", "Synthetic-test-password"),
    ).resolves.toMatchObject({
      account: { username: "synthetic_21" },
    });
  } finally {
    database.close();
  }
});
