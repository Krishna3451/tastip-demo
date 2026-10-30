import { z } from "zod";
import { parseSavedPlaces, type SavedPlaceRecord } from "./saved-places";

export type SavedCollection = {
  id: string;
  name: string;
  placeIds: string[];
  /** Private collection notes, independent of venue facts and itinerary visit notes. */
  placeNotes?: Record<string, string>;
};
export type SavedWorkspace = { places: SavedPlaceRecord[]; collections: SavedCollection[] };
export const EMPTY_SAVED_WORKSPACE: SavedWorkspace = { places: [], collections: [] };
export const MAX_SAVED_WORKSPACE_BYTES = 4_000_000;

export const MAX_COLLECTION_NOTE_LENGTH = 2000;
const placeIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((id) => Boolean(id.trim()));
export const savedCollectionSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(50),
  placeIds: z.array(placeIdSchema).max(150),
  // Keep unresolved notes through imports and membership changes, as with orphan placeIds.
  // An empty string records an explicit clearing so a stale note is not restored by Combine.
  placeNotes: z
    .preprocess(
      // Zod omits this special key while parsing records. Reject the original map
      // before normalization so an import cannot silently lose a private note.
      (value) =>
        value && typeof value === "object" && Object.hasOwn(value, "__proto__") ? null : value,
      z
        .record(placeIdSchema, z.string().max(MAX_COLLECTION_NOTE_LENGTH))
        .refine((notes) => Object.keys(notes).length <= 150),
    )
    .optional(),
});
const collectionsSchema = z.array(savedCollectionSchema).max(50);

/** Legacy place IDs may match Object.prototype names; only stored own notes count. */
export function savedCollectionNote(collection: SavedCollection, placeId: string) {
  const notes = collection.placeNotes;
  return notes && Object.hasOwn(notes, placeId) ? notes[placeId] : undefined;
}

/** A bounded private snapshot. Orphan memberships survive legacy imports until place records arrive. */
export function parseSavedWorkspace(value: unknown): SavedWorkspace | null {
  try {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const raw = JSON.stringify(value);
    if (!raw || new TextEncoder().encode(raw).byteLength > MAX_SAVED_WORKSPACE_BYTES) return null;
    const candidate = value as Record<string, unknown>;
    const places = parseSavedPlaces(JSON.stringify(candidate.places) ?? "");
    const collections = collectionsSchema.safeParse(candidate.collections);
    if (!places || !collections.success) return null;
    if (new Set(collections.data.map((item) => item.id)).size !== collections.data.length)
      return null;
    if (collections.data.some((item) => new Set(item.placeIds).size !== item.placeIds.length))
      return null;
    return { places, collections: collections.data };
  } catch {
    return null;
  }
}
