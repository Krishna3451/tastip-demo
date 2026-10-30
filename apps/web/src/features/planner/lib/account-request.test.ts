import { expect, test } from "bun:test";
import { readMediaBlob, retainMediaForAccount, saveMediaBlob } from "../../reference/media-store";
import {
  AccountRequest,
  AccountResponseError,
  AccountTimeoutError,
  beginAccountMutation,
  finishAccountMutation,
  requestAccount,
} from "./account-request";

const account = { id: "00000000-0000-4000-8000-000000000401", username: "synthetic_alice" };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}

test("deadline covers a stalled account JSON body and ignores a late synthetic result", async () => {
  const original = globalThis.fetch;
  const body = deferred<unknown>();
  const request = new AccountRequest(10);
  globalThis.fetch = (() =>
    Promise.resolve({ ok: true, json: () => body.promise } as Response)) as unknown as typeof fetch;
  try {
    const result = requestAccount(request, "login", {
      username: "synthetic_alice",
      password: "synthetic-password",
    });
    await expect(result).rejects.toBeInstanceOf(AccountTimeoutError);
    expect(request.signal.aborted).toBe(true);
    body.resolve({ account });
    await Promise.resolve();
    await expect(result).rejects.toBeInstanceOf(AccountTimeoutError);
  } finally {
    request.dispose();
    globalThis.fetch = original;
  }
});

test("cancellation settles an uncooperative transport and rejects work started after cancellation", async () => {
  const request = new AccountRequest();
  const transport = deferred<string>();
  const result = request.wait(transport.promise);
  request.cancel();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  transport.resolve("late identity");
  await expect(
    request.wait(Promise.reject(new Error("late rejected transport"))),
  ).rejects.toMatchObject({ name: "AbortError" });
});

test("account mutations are single flight across controls and old cleanup cannot unlock a newer request", () => {
  const first = beginAccountMutation();
  expect(first).not.toBeNull();
  expect(beginAccountMutation()).toBeNull();
  first!.cancel();
  const second = beginAccountMutation();
  expect(second).not.toBeNull();
  finishAccountMutation(first!);
  expect(beginAccountMutation()).toBeNull();
  second!.cancel();
});

test("account transport validates action-specific identities before a caller can migrate a draft", async () => {
  const original = globalThis.fetch;
  const request = new AccountRequest();
  let body: unknown = { account: null };
  globalThis.fetch = (() => Promise.resolve(Response.json(body))) as unknown as typeof fetch;
  try {
    await expect(requestAccount(request, "login")).rejects.toThrow("could not be verified");
    body = { account: { ...account, id: "not-an-account" } };
    await expect(requestAccount(request, "register")).rejects.toThrow("could not be verified");
    body = { account };
    await expect(requestAccount(request, "logout")).rejects.toThrow("could not be verified");
    expect(await requestAccount(request)).toEqual(account);
    globalThis.fetch = (() =>
      Promise.resolve(
        Response.json({ error: { message: "Synthetic rejected login" } }, { status: 401 }),
      )) as unknown as typeof fetch;
    await expect(requestAccount(request, "login")).rejects.toBeInstanceOf(AccountResponseError);
  } finally {
    request.dispose();
    globalThis.fetch = original;
  }
});

function mockDatabase(open: () => unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open } });
  return () => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  };
}

test("cancelled retained-media open closes its late handle without any account copy transaction", async () => {
  let closed = 0;
  let transactions = 0;
  const open = {
    onsuccess: undefined as (() => void) | undefined,
    result: {
      close: () => {
        closed++;
      },
      transaction: () => {
        transactions++;
      },
    },
  };
  const restore = mockDatabase(() => open);
  const controller = new AbortController();
  try {
    const retained = retainMediaForAccount(
      "guest",
      account.id,
      [
        {
          id: "synthetic-file",
          name: "Synthetic.jpg",
          purpose: "media",
          addedAt: "2028-01-01",
          kind: "file",
          mimeType: "image/jpeg",
          size: 3,
        },
      ],
      controller.signal,
    );
    controller.abort(new DOMException("Synthetic cancelled migration", "AbortError"));
    await expect(retained).rejects.toMatchObject({ name: "AbortError" });
    open.onsuccess?.();
    expect(closed).toBe(1);
    expect(transactions).toBe(0);
  } finally {
    restore();
  }
});

test("cancellation aborts an in-flight new media transaction and a late read cannot write bytes", async () => {
  let puts = 0;
  let aborted = 0;
  let closed = 0;
  const listing = { result: [], onsuccess: undefined as (() => void) | undefined };
  const transaction = {
    onabort: undefined as (() => void) | undefined,
    objectStore: () => ({
      index: () => ({ getAll: () => listing }),
      put: () => {
        puts++;
      },
    }),
    abort: () => {
      if (aborted++) throw new Error("Already aborted");
      transaction.onabort?.();
    },
  };
  const db = {
    close: () => {
      closed++;
    },
    transaction: () => transaction,
  };
  const restore = mockDatabase(() => {
    const open = { result: db, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => open.onsuccess?.());
    return open;
  });
  const controller = new AbortController();
  try {
    const saved = saveMediaBlob(account.id, "synthetic-copy", new Blob(["abc"]), controller.signal);
    await Promise.resolve();
    await Promise.resolve();
    controller.abort(new DOMException("Synthetic cancelled copy", "AbortError"));
    await expect(saved).rejects.toMatchObject({ name: "AbortError" });
    listing.onsuccess?.();
    expect(aborted).toBeGreaterThanOrEqual(1);
    expect(puts).toBe(0);
    expect(closed).toBe(1);
    await expect(readMediaBlob("guest", "synthetic-copy", controller.signal)).rejects.toMatchObject(
      { name: "AbortError" },
    );
  } finally {
    restore();
  }
});

test("an ownership change before the copy callback prevents writes even before effect-driven abort", async () => {
  let current = true;
  let puts = 0;
  const listing = { result: [], onsuccess: undefined as (() => void) | undefined };
  const transaction = {
    onabort: undefined as (() => void) | undefined,
    objectStore: () => ({
      index: () => ({ getAll: () => listing }),
      put: () => {
        puts++;
      },
    }),
    abort: () => transaction.onabort?.(),
  };
  const db = { close() {}, transaction: () => transaction };
  const restore = mockDatabase(() => {
    const open = { result: db, onsuccess: undefined as (() => void) | undefined };
    queueMicrotask(() => open.onsuccess?.());
    return open;
  });
  const controller = new AbortController();
  try {
    const saved = saveMediaBlob(
      account.id,
      "synthetic-copy",
      new Blob(["abc"]),
      controller.signal,
      () => current,
    );
    await Promise.resolve();
    await Promise.resolve();
    current = false;
    listing.onsuccess?.();
    await expect(saved).rejects.toThrow();
    expect(controller.signal.aborted).toBe(false);
    expect(puts).toBe(0);
  } finally {
    restore();
  }
});
