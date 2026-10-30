import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DESTINATIONS } from "@tastip/domain";
import {
  EMPTY_SAVED_WORKSPACE,
  type SavedWorkspace,
} from "../features/planner/lib/saved-workspace";
import { openDatabase } from "./database";
import { SavedWorkspaceStore } from "./saved-store";

function fixture(): SavedWorkspace {
  const destination = DESTINATIONS[0];
  if (!destination) throw new Error("Missing fixture destination.");
  return {
    places: [
      {
        destination,
        place: {
          id: "qloo:saved-store-fixture",
          destinationId: destination.id,
          name: "Synthetic saved Qloo fixture",
          description: "Synthetic persistence fixture, not a real venue.",
          lat: destination.lat,
          lng: destination.lng,
          category: "culture",
          source: "qloo",
          taste: { queryId: "saved-store-fixture-query", rank: 9 },
          practical: { hours: "unknown", cost: "unknown" },
        },
      },
    ],
    collections: [
      {
        id: "00000000-0000-4000-8000-000000000028",
        name: "Private ideas",
        placeIds: ["qloo:saved-store-fixture", "orphan:retained"],
        placeNotes: {
          "qloo:saved-store-fixture": "Private owner note",
          "orphan:retained": "Retained imported note",
        },
      },
    ],
  };
}

test("owner-scoped Saved snapshots survive reopen, reject stale writers and keep cleared revisions", () => {
  const directory = mkdtempSync(join(tmpdir(), "tastip-saved-store-"));
  const path = join(directory, "saved.sqlite");
  const db = openDatabase(path);
  for (const owner of ["alice", "bob"])
    db.prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(
      owner,
      owner,
      "synthetic-unused",
      0,
    );
  let store = new SavedWorkspaceStore(db, () => 1000);
  const other = new SavedWorkspaceStore(openDatabase(path), () => 2000);
  try {
    expect(store.get("alice")).toEqual({ workspace: null, revision: 0, updatedAt: null });
    const input = fixture();
    const first = store.save("alice", input, 0);
    expect(first).toEqual({ workspace: fixture(), revision: 1, updatedAt: 1000 });
    input.collections[0]!.name = "Changed caller";
    expect(store.get("alice").workspace).toEqual(fixture());
    expect(other.get("alice").workspace).toEqual(fixture());
    expect(other.get("bob")).toEqual({ workspace: null, revision: 0, updatedAt: null });
    expect(() =>
      store.save(
        "alice",
        {
          ...fixture(),
          collections: [
            {
              ...fixture().collections[0],
              placeNotes: { "qloo:saved-store-fixture": "x".repeat(2001) },
            },
          ],
        },
        1,
      ),
    ).toThrow("valid saved workspace");
    expect(store.get("alice").workspace).toEqual(fixture());
    expect(() => other.save("alice", EMPTY_SAVED_WORKSPACE, 0)).toThrow("another device");
    expect(() => store.clear("alice", 0)).toThrow("another device");
    expect(store.clear("alice", 1)).toEqual({ workspace: null, revision: 2, updatedAt: 1000 });
    expect(() => other.save("alice", fixture(), 1)).toThrow("another device");
    store.close();
    store = new SavedWorkspaceStore(openDatabase(path), () => 3000);
    expect(store.get("alice")).toEqual({ workspace: null, revision: 2, updatedAt: 1000 });
    expect(store.save("alice", fixture(), 2).revision).toBe(3);
    expect(store.get("bob").revision).toBe(0);
    expect(() => store.save("alice", { places: [], collections: [{ id: "bad" }] }, 3)).toThrow(
      "valid saved workspace",
    );
    expect(() => store.clear("alice", -1)).toThrow("Refresh");
    expect(store.get("alice").revision).toBe(3);
  } finally {
    store.close();
    other.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("corrupt saved storage blocks reads and replacement without erasing its recoverable payload", () => {
  const db = openDatabase(":memory:");
  db.prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(
    "alice",
    "alice",
    "synthetic-unused",
    0,
  );
  const store = new SavedWorkspaceStore(db, () => 1000);
  try {
    store.save("alice", fixture(), 0);
    db.prepare("UPDATE saved_workspaces SET payload=? WHERE owner_id=?").run(
      "{damaged saved fixture",
      "alice",
    );
    expect(() => store.get("alice")).toThrow("saved copy has been kept");
    expect(() => store.save("alice", EMPTY_SAVED_WORKSPACE, 1)).toThrow("saved copy has been kept");
    expect(() => store.clear("alice", 1)).toThrow("saved copy has been kept");
    expect(
      db.prepare("SELECT payload,revision FROM saved_workspaces WHERE owner_id=?").get("alice"),
    ).toEqual({ payload: "{damaged saved fixture", revision: 1 });
  } finally {
    store.close();
  }
});
