import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseTasteProfile, type TasteProfile } from "@tastip/domain";
import { openDatabase } from "./database";
import { TripStore } from "./trip-store";

const profile: TasteProfile = {
  seeds: [{ id: "synthetic-movie", name: "Synthetic film favorite", type: "urn:entity:movie" }],
  dayStyle: "Art and independent shops",
  categories: ["culture", "shop"],
  rhythm: "late",
  dietary: ["Vegetarian"],
  walking: "short",
  lodging: "Boutique & character",
};

test("saved preferences are bounded and contain only explicit recognized fields", () => {
  const input = {
    ...structuredClone(profile),
    privateNote: "omit",
    seeds: [{ ...profile.seeds[0]!, inferredIdentity: "omit" }],
  };
  const parsed = parseTasteProfile(input);
  expect(parsed).toEqual(profile);
  input.seeds[0]!.name = "Changed outside parser";
  expect(parsed?.seeds[0]?.name).toBe(profile.seeds[0]!.name);
  expect(parseTasteProfile({ ...profile, seeds: [profile.seeds[0], profile.seeds[0]] })).toBeNull();
  expect(parseTasteProfile({ ...profile, dietary: Array(13).fill("Vegetarian") })).toBeNull();
  expect(parseTasteProfile({ ...profile, dayStyle: "x".repeat(301) })).toBeNull();
  expect(parseTasteProfile({ ...profile, rhythm: "inferred" })).toBeNull();
});

test("account preferences persist independently, reject stale writes and cannot be resurrected after forgetting", () => {
  const directory = mkdtempSync(join(tmpdir(), "tastip-profile-"));
  const path = join(directory, "private.sqlite");
  let store: TripStore | undefined;
  try {
    const db = openDatabase(path);
    for (const owner of ["alice", "bob"])
      db.prepare("INSERT INTO accounts(id,username,password_hash,created_at) VALUES(?,?,?,?)").run(
        owner,
        owner,
        "synthetic-unused",
        0,
      );
    store = new TripStore(db, () => 1000);
    expect(store.tasteProfile("alice")).toEqual({ profile: null, revision: 0, updatedAt: null });
    expect(store.saveTasteProfile("alice", profile, 0)).toEqual({
      profile,
      revision: 1,
      updatedAt: 1000,
    });
    expect(store.tasteProfile("bob").profile).toBeNull();
    expect(() => store!.saveTasteProfile("alice", { ...profile, rhythm: "early" }, 0)).toThrow(
      "another tab",
    );
    store.close();
    store = new TripStore(openDatabase(path), () => 2000);
    expect(store.tasteProfile("alice").profile).toEqual(profile);
    expect(store.saveTasteProfile("alice", null, 1)).toEqual({
      profile: null,
      revision: 2,
      updatedAt: 2000,
    });
    expect(() => store!.saveTasteProfile("alice", profile, 1)).toThrow("another tab");
    expect(store.tasteProfile("alice").profile).toBeNull();
    expect(() =>
      store!.saveTasteProfile("alice", { ...profile, seeds: Array(21).fill(profile.seeds[0]) }, 2),
    ).toThrow("valid, confirmed");
    expect(store.tasteProfile("alice").revision).toBe(2);
  } finally {
    store?.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
