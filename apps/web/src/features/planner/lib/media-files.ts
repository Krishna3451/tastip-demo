import { MAX_MEDIA_BYTES, type TripMedia } from "@tastip/domain";

export function mediaMimeType(
  bytes: Uint8Array,
): Extract<TripMedia, { kind: "file" }>["mimeType"] | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value))
    return "image/png";
  const text = new TextDecoder().decode(bytes.slice(0, 12));
  if (text.startsWith("RIFF") && text.slice(8, 12) === "WEBP") return "image/webp";
  if (text.startsWith("%PDF-")) return "application/pdf";
  return null;
}
export async function validateMediaFile(
  file: File,
): Promise<Extract<TripMedia, { kind: "file" }>["mimeType"]> {
  if (!file.size || file.size > MAX_MEDIA_BYTES)
    throw new Error("Choose a photo or PDF up to 10 MB.");
  const type = mediaMimeType(new Uint8Array(await file.slice(0, 16).arrayBuffer()));
  if (!type)
    throw new Error("Choose a JPEG, PNG, WebP photo or PDF. This file type is not supported.");
  return type;
}
