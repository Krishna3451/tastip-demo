import type { TripMedia } from "./types";

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export function validMedia(value: unknown): value is TripMedia {
  if (!value || typeof value !== "object") return false;
  const item = value as TripMedia;
  if (
    typeof item.id !== "string" ||
    !/^[A-Za-z0-9-]{1,80}$/.test(item.id) ||
    typeof item.name !== "string" ||
    !item.name.trim() ||
    item.name.length > 240 ||
    Array.from(item.name).some((character) => character.charCodeAt(0) < 32) ||
    typeof item.addedAt !== "string" ||
    item.addedAt.length > 40 ||
    !Number.isFinite(Date.parse(item.addedAt)) ||
    !["media", "receipt"].includes(item.purpose)
  )
    return false;
  if (new Date(item.addedAt).toISOString() !== item.addedAt) return false;
  const allowed = [
    "id",
    "name",
    "addedAt",
    "purpose",
    "kind",
    ...(item.kind === "file" ? ["mimeType", "size"] : ["url"]),
  ];
  if (Object.keys(item).some((key) => !allowed.includes(key))) return false;
  if (item.kind === "file")
    return (
      ["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(item.mimeType) &&
      Number.isSafeInteger(item.size) &&
      item.size > 0 &&
      item.size <= MAX_MEDIA_BYTES
    );
  if (item.kind !== "link" || typeof item.url !== "string" || item.url.length > 2048) return false;
  try {
    const url = new URL(item.url);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password
    );
  } catch {
    return false;
  }
}
