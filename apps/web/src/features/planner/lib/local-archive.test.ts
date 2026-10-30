import { expect, test } from "bun:test";
import { createDemoTrip, DEFAULT_BRIEF } from "@tastip/domain";
import { archiveBeforeLeaving } from "./local-archive";

test("leaving a draft preserves latest accepted trip and does not evict other work", () => {
  let value = "[]";
  const storage = {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
  const trip = createDemoTrip(DEFAULT_BRIEF);
  archiveBeforeLeaving(storage, trip);
  archiveBeforeLeaving(storage, trip);
  expect(JSON.parse(value)).toHaveLength(1);
  expect(JSON.parse(value)[0].id).toBe(trip.id);
  value = JSON.stringify(Array.from({ length: 12 }, () => createDemoTrip(DEFAULT_BRIEF)));
  expect(() => archiveBeforeLeaving(storage, trip)).toThrow("full");
  expect(JSON.parse(value)).toHaveLength(12);
});

test("account archives cannot overwrite the guest or another account collection", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
  const guest = createDemoTrip(DEFAULT_BRIEF);
  const alice = createDemoTrip(DEFAULT_BRIEF);
  const bob = createDemoTrip(DEFAULT_BRIEF);
  archiveBeforeLeaving(storage, guest);
  archiveBeforeLeaving(storage, alice, "tastip.library.v1:alice");
  archiveBeforeLeaving(storage, bob, "tastip.library.v1:bob");
  expect(JSON.parse(values.get("tastip.library.v1") ?? "[]")[0].id).toBe(guest.id);
  expect(JSON.parse(values.get("tastip.library.v1:alice") ?? "[]")[0].id).toBe(alice.id);
  expect(JSON.parse(values.get("tastip.library.v1:bob") ?? "[]")[0].id).toBe(bob.id);
});
