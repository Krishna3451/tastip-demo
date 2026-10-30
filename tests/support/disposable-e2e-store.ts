import { randomUUID } from "node:crypto";
import {
  lstatSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Environment = Record<string, string | undefined>;
const MARKER = ".tastip-e2e-disposable.json";
const PREFIX = "tastip-e2e-store-";
function fail(): never {
  throw new Error("Registration quota cleanup requires this run’s owned disposable E2E store.");
}
function privatePath(path: string, directory: boolean, mode: number) {
  const info = lstatSync(path);
  if (
    info.isSymbolicLink() ||
    (directory ? !info.isDirectory() : !info.isFile()) ||
    info.uid !== process.getuid?.() ||
    (info.mode & 0o777) !== mode ||
    (!directory && info.nlink !== 1)
  )
    fail();
  return info;
}
function directory(path: string) {
  const full = resolve(path);
  if (!basename(full).startsWith(PREFIX)) fail();
  privatePath(full, true, 0o700);
  const canonical = realpathSync(full);
  const parent = dirname(canonical);
  if (![realpathSync(tmpdir()), realpathSync("/tmp")].includes(parent)) fail();
  return canonical;
}
function owned(env: Environment, origin: string) {
  if (!env.TASTIP_E2E_DATA_DIR || !env.TASTIP_E2E_STORE_ID) fail();
  const path = directory(env.TASTIP_E2E_DATA_DIR);
  const marker = join(path, MARKER);
  if (privatePath(marker, false, 0o600).size > 512) fail();
  const value: unknown = JSON.parse(readFileSync(marker, "utf8"));
  if (
    !value ||
    typeof value !== "object" ||
    !("run" in value) ||
    !("origin" in value) ||
    !("kind" in value) ||
    value.kind !== "tastip-disposable-e2e" ||
    value.run !== env.TASTIP_E2E_STORE_ID ||
    value.origin !== origin
  )
    fail();
  return path;
}

/** Config runs before worker/server launch. Its marker and ID are inherited by workers. */
export function prepareDisposableE2EStore(origin: string, env: Environment = process.env) {
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(origin)) fail();
  if (env.TASTIP_E2E_STORE_ID) return owned(env, origin);
  const supplied = env.TASTIP_E2E_DATA_DIR;
  // A supplied directory must be newly empty in system temp. Never adopt an existing database.
  if (supplied) {
    privatePath(supplied, true, 0o700);
    const canonical = realpathSync(supplied);
    const systemTemps = [realpathSync(tmpdir()), realpathSync("/tmp")];
    if (!systemTemps.includes(dirname(canonical)) || readdirSync(canonical).length) fail();
  }
  // Always own a new, recognizable sibling directory; an operator-provided path is not a marker.
  const path = realpathSync(mkdtempSync(join(tmpdir(), PREFIX)));
  const run = randomUUID();
  writeFileSync(
    join(path, MARKER),
    JSON.stringify({ kind: "tastip-disposable-e2e", run, origin }),
    { mode: 0o600, flag: "wx" },
  );
  env.TASTIP_E2E_DATA_DIR = path;
  env.TASTIP_E2E_STORE_ID = run;
  return path;
}

/** Test fixture isolation only. Production quota and all account/private data are untouched. */
export function resetE2ERegistrationQuota(origin: string, env: Environment = process.env) {
  if (env.TASTIP_E2E_REUSE_SERVER === "1") fail();
  const path = owned(env, origin);
  const file = join(path, "tastip.sqlite");
  try {
    privatePath(file, false, 0o600);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
  // The directory marker was created only while empty; reject symlinked/hard-linked DB files.
  if (relative(path, realpathSync(file)) !== "tastip.sqlite") fail();
  const database = new DatabaseSync(file);
  try {
    database.exec("PRAGMA busy_timeout=5000");
    database.prepare("DELETE FROM rate_buckets WHERE bucket = ?").run("register:global");
  } finally {
    database.close();
  }
}
