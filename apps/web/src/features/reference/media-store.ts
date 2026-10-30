"use client";

import type { TripMedia } from "@tastip/domain";

type Asset = { key: string; scope: string; blob: Blob };
function openDatabase(signal?: AbortSignal): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error("File storage is unavailable in this browser."));
      return;
    }
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const cancelled = () => reject(signal?.reason);
    signal?.addEventListener("abort", cancelled, { once: true });
    const request = indexedDB.open("tastip-private-media", 1);
    request.onupgradeneeded = () => {
      if (signal?.aborted) {
        request.transaction?.abort();
        return;
      }
      const files = request.result.createObjectStore("files", { keyPath: "key" });
      files.createIndex("scope", "scope");
    };
    request.onsuccess = () => {
      signal?.removeEventListener("abort", cancelled);
      if (signal?.aborted) {
        request.result.close();
        reject(signal.reason);
        return;
      }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
    request.onerror = () => {
      signal?.removeEventListener("abort", cancelled);
      reject(new Error("Your browser could not open file storage."));
    };
    request.onblocked = () => {
      signal?.removeEventListener("abort", cancelled);
      reject(new Error("Close older Tastip tabs, then try adding the file again."));
    };
  });
}
export async function saveMediaBlob(
  scope: string,
  id: string,
  blob: Blob,
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const db = await openDatabase(signal);
  if (signal?.aborted || !isCurrent()) {
    db.close();
    throw signal?.reason ?? new DOMException("Account changed", "AbortError");
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite");
    const cancelled = () => {
      try {
        transaction.abort();
      } catch {
        /* Already settled. */
      }
    };
    signal?.addEventListener("abort", cancelled, { once: true });
    const store = transaction.objectStore("files");
    let quota = false;
    const request = store.index("scope").getAll(scope);
    request.onsuccess = () => {
      if (signal?.aborted || !isCurrent()) {
        cancelled();
        return;
      }
      const existing = request.result as Asset[];
      const size = existing
        .filter((asset) => asset.key !== `${scope}:${id}`)
        .reduce((sum, asset) => sum + asset.blob.size, 0);
      if (size + blob.size > 50 * 1024 * 1024) {
        quota = true;
        transaction.abort();
        return;
      }
      store.put({ key: `${scope}:${id}`, scope, blob } satisfies Asset);
    };
    transaction.oncomplete = () => {
      signal?.removeEventListener("abort", cancelled);
      db.close();
      if (signal?.aborted) reject(signal.reason);
      else resolve();
    };
    transaction.onabort = transaction.onerror = () => {
      signal?.removeEventListener("abort", cancelled);
      db.close();
      reject(
        signal?.aborted
          ? signal.reason
          : new Error(
              quota
                ? "This account’s device storage has reached 50 MB. Keep file backups before clearing any browser data."
                : "Your browser could not save this file. Check available storage and try again.",
            ),
      );
    };
  });
}
export async function readMediaBlob(
  scope: string,
  id: string,
  signal?: AbortSignal,
): Promise<Blob | null> {
  const db = await openDatabase(signal);
  if (signal?.aborted) {
    db.close();
    throw signal.reason;
  }
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readonly");
    const cancelled = () => {
      try {
        transaction.abort();
      } catch {
        /* Already settled. */
      }
    };
    signal?.addEventListener("abort", cancelled, { once: true });
    const request = transaction.objectStore("files").get(`${scope}:${id}`);
    transaction.oncomplete = () => {
      signal?.removeEventListener("abort", cancelled);
      db.close();
      if (signal?.aborted) {
        reject(signal.reason);
        return;
      }
      const asset = request.result as Asset | undefined;
      resolve(asset?.scope === scope && asset.blob instanceof Blob ? asset.blob : null);
    };
    transaction.onabort = transaction.onerror = () => {
      signal?.removeEventListener("abort", cancelled);
      db.close();
      reject(signal?.aborted ? signal.reason : new Error("Your browser could not read this file."));
    };
  });
}
/** Roll back only a newly written blob whose canonical add command failed. Removed media retains bytes for Undo. */
export async function discardUnattachedBlob(scope: string, id: string): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("files", "readwrite");
    transaction.objectStore("files").delete(`${scope}:${id}`);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onabort = transaction.onerror = () => {
      db.close();
      reject(new Error("The temporary file could not be cleared."));
    };
  });
}

/** Keep the guest originals while copying a traveler-confirmed retained draft into their account. */
export async function retainMediaForAccount(
  from: string,
  to: string,
  media: TripMedia[],
  signal?: AbortSignal,
  isCurrent: () => boolean = () => true,
) {
  const results = await Promise.allSettled(
    media
      .filter((item) => item.kind === "file")
      .map(async (item) => {
        const blob = await readMediaBlob(from, item.id, signal);
        if (signal?.aborted || !isCurrent())
          throw signal?.reason ?? new DOMException("Account changed", "AbortError");
        if (!blob || item.kind !== "file" || blob.size !== item.size || blob.type !== item.mimeType)
          throw new Error("File unavailable");
        await saveMediaBlob(to, item.id, blob, signal, isCurrent);
      }),
  );
  if (signal?.aborted || !isCurrent())
    throw signal?.reason ?? new DOMException("Account changed", "AbortError");
  return results.filter((result) => result.status === "rejected").length;
}
