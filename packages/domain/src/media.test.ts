import { expect, test } from "bun:test";
import { createTripFromPlaces, DEFAULT_BRIEF } from "./fixtures";
import { MAX_MEDIA_BYTES, validMedia } from "./media";
import { parseStoredTrip } from "./storage";
import { applyTripCommand, undoTripCommand } from "./trip";
import type { TripMedia } from "./types";

const link: TripMedia = {
  id: "private-link",
  name: "Travel inspiration",
  kind: "link",
  url: "https://example.com/guide",
  addedAt: "2027-03-01T00:00:00.000Z",
  purpose: "media",
};
const file: TripMedia = {
  id: "private-receipt",
  name: "Receipt.pdf",
  kind: "file",
  mimeType: "application/pdf",
  size: 4096,
  addedAt: "2027-03-01T00:00:00.000Z",
  purpose: "receipt",
};

test("media commands retain private metadata through reload/replay and undo removal", () => {
  const before = createTripFromPlaces(DEFAULT_BRIEF, []);
  const command = {
    id: "add-media",
    baseVersion: before.version,
    operations: [
      { type: "add-media" as const, media: link },
      { type: "add-media" as const, media: file },
    ],
  };
  const added = applyTripCommand(before, command);
  if (!added.ok) throw new Error(added.error.message);
  const restored = parseStoredTrip(JSON.parse(JSON.stringify(added.trip)));
  expect(restored?.media).toEqual([link, file]);
  expect(restored && applyTripCommand(restored, command).ok).toBe(true);
  expect(
    applyTripCommand(added.trip, {
      id: "duplicate",
      baseVersion: added.trip.version,
      operations: [{ type: "add-media", media: link }],
    }).ok,
  ).toBe(false);
  const removed = applyTripCommand(added.trip, {
    id: "remove-media",
    baseVersion: added.trip.version,
    operations: [{ type: "remove-media", mediaId: file.id }],
  });
  if (!removed.ok) throw new Error(removed.error.message);
  expect(removed.trip.media).toEqual([link]);
  const undone = undoTripCommand(removed.trip, removed.receipt, "restore-media");
  expect(undone.ok && undone.trip.media).toEqual([link, file]);
  expect(
    parseStoredTrip({ ...added.trip, media: [{ ...link, url: "javascript:alert(1)" }] }),
  ).toBeNull();
});

test("attachment validation rejects executable links, credentials, unsafe file types and binary payload fields", () => {
  expect(validMedia(file)).toBe(true);
  expect(validMedia(link)).toBe(true);
  for (const url of [
    "javascript:alert(1)",
    "data:text/html,unsafe",
    "file:///private",
    "https://user:password@example.com",
  ])
    expect(validMedia({ ...link, url })).toBe(false);
  expect(validMedia({ ...file, mimeType: "image/svg+xml" })).toBe(false);
  expect(validMedia({ ...file, size: MAX_MEDIA_BYTES + 1 })).toBe(false);
  expect(validMedia({ ...file, size: 0 })).toBe(false);
  expect(validMedia({ ...file, addedAt: "not a date" })).toBe(false);
  expect(validMedia({ ...file, rawFileBytes: "must stay outside canonical state" })).toBe(false);
  expect(validMedia({ ...file, name: "bad\nname.pdf" })).toBe(false);
});
