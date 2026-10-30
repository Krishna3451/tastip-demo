import { expect, test } from "bun:test";
import { MAX_MEDIA_BYTES } from "@tastip/domain";
import { mediaMimeType, validateMediaFile } from "./media-files";

test("photo and PDF upload validation checks byte signatures and file size", async () => {
  expect(mediaMimeType(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]))).toBe("image/png");
  expect(mediaMimeType(new Uint8Array([255, 216, 255, 224]))).toBe("image/jpeg");
  expect(mediaMimeType(new TextEncoder().encode("RIFF0000WEBP"))).toBe("image/webp");
  expect(
    await validateMediaFile(new File(["%PDF-1.7\nSynthetic test content"], "receipt.pdf")),
  ).toBe("application/pdf");
  await expect(
    validateMediaFile(new File(["<svg/>"], "not-a-photo.png", { type: "image/png" })),
  ).rejects.toThrow("not supported");
  await expect(
    validateMediaFile(new File([new Uint8Array(MAX_MEDIA_BYTES + 1)], "too-large.pdf")),
  ).rejects.toThrow("up to 10 MB");
  await expect(validateMediaFile(new File([], "empty.pdf"))).rejects.toThrow("up to 10 MB");
});
