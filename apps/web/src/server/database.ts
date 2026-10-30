import { chmodSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

type Scalar = string | number | null;
type Statement = {
  get(...params: Scalar[]): unknown;
  all(...params: Scalar[]): unknown[];
  run(...params: Scalar[]): unknown;
};
export type Database = { exec(sql: string): void; prepare(sql: string): Statement; close(): void };

/** Use the same built-in SQLite contract in Next, Node and the pinned Bun runtime. */
export function openDatabase(path: string): Database {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(path);
  if (path !== ":memory:") chmodSync(path, 0o600);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS trips (owner_id TEXT NOT NULL REFERENCES accounts(id), trip_id TEXT NOT NULL, payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(owner_id,trip_id));
    CREATE TABLE IF NOT EXISTS shares (token TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES accounts(id), trip_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS sessions_user_expiry ON sessions(user_id,expires_at);
    CREATE INDEX IF NOT EXISTS shares_owner_trip ON shares(owner_id,trip_id,created_at);
    CREATE TABLE IF NOT EXISTS rate_buckets (bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);`);
  db.exec(
    `CREATE TABLE IF NOT EXISTS taste_profiles (owner_id TEXT PRIMARY KEY REFERENCES accounts(id), profile TEXT, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS conversation_backups (owner_id TEXT PRIMARY KEY REFERENCES accounts(id), payload TEXT, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
  );
  db.exec(
    `CREATE TABLE IF NOT EXISTS saved_workspaces (owner_id TEXT PRIMARY KEY REFERENCES accounts(id), payload TEXT, revision INTEGER NOT NULL, updated_at INTEGER NOT NULL);`,
  );
  return db;
}
export function databasePath() {
  return resolve(process.env.TASTIP_DATA_DIR ?? resolve(process.cwd(), ".data"), "tastip.sqlite");
}
