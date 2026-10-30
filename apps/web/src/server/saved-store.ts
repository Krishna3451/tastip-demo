import {
  MAX_SAVED_WORKSPACE_BYTES,
  parseSavedWorkspace,
  type SavedWorkspace,
} from "../features/planner/lib/saved-workspace";
import { type Database, databasePath, openDatabase } from "./database";
import { ServiceError } from "./service-error";

export type SavedWorkspaceSnapshot = {
  workspace: SavedWorkspace | null;
  revision: number;
  updatedAt: number | null;
};
type Row = { payload: string | null; revision: number; updated_at: number };

/** Owner-scoped snapshots use an atomic revision check; clears keep a revision tombstone. */
export class SavedWorkspaceStore {
  constructor(
    private readonly db: Database,
    private readonly now = Date.now,
  ) {}

  get(owner: string): SavedWorkspaceSnapshot {
    const row = this.db
      .prepare("SELECT payload,revision,updated_at FROM saved_workspaces WHERE owner_id=?")
      .get(owner) as Row | undefined;
    if (!row) return { workspace: null, revision: 0, updatedAt: null };
    let workspace: SavedWorkspace | null = null;
    try {
      if (
        row.payload !== null &&
        typeof row.payload === "string" &&
        Buffer.byteLength(row.payload, "utf8") <= MAX_SAVED_WORKSPACE_BYTES
      )
        workspace = parseSavedWorkspace(JSON.parse(row.payload));
    } catch {
      /* Corrupt data is preserved and blocks replacement. */
    }
    if (
      (row.payload !== null && !workspace) ||
      !Number.isSafeInteger(row.revision) ||
      row.revision < 1 ||
      !Number.isSafeInteger(row.updated_at) ||
      row.updated_at < 0
    )
      throw new ServiceError(
        "SAVED_UNAVAILABLE",
        "Your account saves could not be read. The saved copy has been kept.",
        500,
      );
    return { workspace, revision: row.revision, updatedAt: row.updated_at };
  }

  save(owner: string, value: unknown, expectedRevision: number): SavedWorkspaceSnapshot {
    let raw: string | undefined;
    try {
      raw = JSON.stringify(value);
    } catch {
      /* Reject cyclic/non-JSON data below. */
    }
    if (raw && Buffer.byteLength(raw, "utf8") > MAX_SAVED_WORKSPACE_BYTES)
      throw new ServiceError(
        "SAVED_TOO_LARGE",
        "Your saved workspace exceeds the 4 MB limit.",
        413,
      );
    const workspace = parseSavedWorkspace(value);
    if (!workspace)
      throw new ServiceError(
        "INVALID_SAVED_WORKSPACE",
        "Choose a valid saved workspace with at most 100 places and 50 collections.",
      );
    return this.write(owner, workspace, expectedRevision);
  }

  clear(owner: string, expectedRevision: number): SavedWorkspaceSnapshot {
    return this.write(owner, null, expectedRevision);
  }

  private write(
    owner: string,
    workspace: SavedWorkspace | null,
    expectedRevision: number,
  ): SavedWorkspaceSnapshot {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
      throw new ServiceError(
        "INVALID_SAVED_REVISION",
        "Refresh your account saves before changing them.",
      );
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(owner);
      if (previous.revision !== expectedRevision)
        throw new ServiceError(
          "SAVED_CONFLICT",
          "Your account saves changed on another device. Refresh and review them before saving again.",
          409,
        );
      if (previous.revision === Number.MAX_SAFE_INTEGER)
        throw new ServiceError(
          "SAVED_UNAVAILABLE",
          "Your account saves could not be updated. The saved copy has been kept.",
          500,
        );
      const revision = previous.revision + 1;
      const updatedAt = this.now();
      if (!Number.isSafeInteger(updatedAt) || updatedAt < 0)
        throw new ServiceError(
          "SAVED_UNAVAILABLE",
          "Your account saves could not be updated. Try again.",
          500,
        );
      this.db
        .prepare(
          "INSERT INTO saved_workspaces(owner_id,payload,revision,updated_at) VALUES(?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at",
        )
        .run(owner, workspace === null ? null : JSON.stringify(workspace), revision, updatedAt);
      this.db.exec("COMMIT");
      return { workspace, revision, updatedAt };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  close() {
    this.db.close();
  }
}
let activeStore: SavedWorkspaceStore | undefined;
export function getSavedStore() {
  activeStore ??= new SavedWorkspaceStore(openDatabase(databasePath()));
  return activeStore;
}
