import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF, DESTINATIONS } from "@tastip/domain";
import { combineSaved } from "../../reference/use-saved-workspace";
import type { SavedWorkspace } from "./saved-workspace";

const collectionId = "00000000-0000-4000-8000-000000000071";
function copies() {
  const place = createDemoTrip(DEFAULT_BRIEF).places[0]!;
  const account: SavedWorkspace = {
    places: [
      {
        place: { ...place, source: "qloo", taste: { queryId: "account-query", rank: 7 } },
        destination: DESTINATIONS[0]!,
      },
    ],
    collections: [{ id: collectionId, name: "Account name", placeIds: [place.id] }],
  };
  const device = structuredClone(account);
  device.places[0]!.place.taste = { queryId: "device-query", rank: 1 };
  device.collections[0] = {
    id: collectionId,
    name: "Device rename",
    placeIds: ["orphan-legacy-place"],
  };
  return { account, device };
}
test("explicit Saved combination keeps account provenance, adds unique memberships and changes neither copy", () => {
  const { account, device } = copies();
  const originals = structuredClone({ account, device });
  const merged = combineSaved(account, device);
  expect(merged.places[0]!.place.taste).toEqual({ queryId: "account-query", rank: 7 });
  expect(merged.collections[0]).toEqual({
    id: collectionId,
    name: "Account name",
    placeIds: [account.places[0]!.place.id, "orphan-legacy-place"],
  });
  expect({ account, device }).toEqual(originals);
  merged.collections[0]!.placeIds.push("changed-after-merge");
  expect(account.collections[0]!.placeIds).not.toContain("changed-after-merge");
});
test("combining over collection limits rejects the merge without dropping either copy", () => {
  const { account, device } = copies();
  account.collections = Array.from({ length: 50 }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `Account ${index}`,
    placeIds: [],
  }));
  device.collections = [{ id: collectionId, name: "Unique device collection", placeIds: [] }];
  expect(() => combineSaved(account, device)).toThrow("limits");
  expect(account.collections).toHaveLength(50);
  expect(device.collections).toHaveLength(1);
});

test("explicit note combination keeps account conflicts and clearings, adds device-only notes and preserves both originals", () => {
  const { account, device } = copies();
  const placeId = account.places[0]!.place.id;
  account.collections[0]!.placeNotes = { [placeId]: "Account private note", cleared: "" };
  device.collections[0]!.placeNotes = {
    [placeId]: "Divergent device draft",
    cleared: "Stale note",
    "orphan-legacy-place": "Device-only note",
  };
  const originals = structuredClone({ account, device });
  const merged = combineSaved(account, device);
  expect(merged.collections[0]?.placeNotes).toEqual({
    [placeId]: "Account private note",
    cleared: "",
    "orphan-legacy-place": "Device-only note",
  });
  expect(merged.collections[0]?.id).toBe(collectionId);
  expect(merged.places[0]?.place.taste).toEqual({ queryId: "account-query", rank: 7 });
  expect({ account, device }).toEqual(originals);
  merged.collections[0]!.placeNotes![placeId] = "Mutated result";
  expect(account.collections[0]?.placeNotes?.[placeId]).toBe("Account private note");
});

test("combined note limits reject atomically while legacy collections without notes remain unchanged", () => {
  const { account, device } = copies();
  account.collections[0]!.placeNotes = Object.fromEntries(
    Array.from({ length: 150 }, (_, i) => [`note-${i}`, "Account note"]),
  );
  device.collections[0]!.placeNotes = { "new-note": "Device note" };
  const originals = structuredClone({ account, device });
  expect(() => combineSaved(account, device)).toThrow("limits");
  expect({ account, device }).toEqual(originals);
  const legacy = copies();
  expect(combineSaved(legacy.account, legacy.device).collections[0]).not.toHaveProperty(
    "placeNotes",
  );
});
