import { expect, type Page, type Route, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src";

const alice = { id: "00000000-0000-4000-8000-000000000401", username: "synthetic_alice" };
const bob = { id: "00000000-0000-4000-8000-000000000402", username: "synthetic_bob" };
const sessionKey = "tastip.session.change.v1";
const tripKey = "tastip.trip.v1";
function gate() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function fixture(
  page: Page,
  options: { owner?: typeof alice; holdGet?: boolean; holdPost?: boolean; media?: boolean } = {},
) {
  let owner = options.owner ?? null;
  let gets = 0;
  let allowGets = !options.holdGet;
  let posts = 0;
  const heldGet = gate();
  const heldPost = gate();
  const trip = createDemoTrip(DEFAULT_BRIEF);
  if (options.media)
    trip.media = [
      {
        id: "synthetic-media",
        name: "Synthetic.jpg",
        addedAt: "2028-01-01T00:00:00.000Z",
        purpose: "media",
        kind: "file",
        mimeType: "image/jpeg",
        size: 3,
      },
    ];
  const unexpected: string[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/health")
      return route.fulfill({ json: { providers: { openai: false, qloo: false } } });
    if (path === "/api/maps/config" && route.request().method() === "GET")
      return route.fulfill({ json: { enabled: false } });
    if (path === "/api/trips") return route.fulfill({ json: { trips: [] } });
    if (path === "/api/profile") return route.fulfill({ json: { profile: null, revision: 0 } });
    if (path === "/api/saved")
      return route.fulfill({ json: { workspace: null, revision: 0, updatedAt: null } });
    if (path !== "/api/account") {
      unexpected.push(path);
      return route.fulfill({
        status: 503,
        json: { error: { message: "Synthetic unexpected endpoint" } },
      });
    }
    if (route.request().method() === "POST") {
      posts++;
      const action = route.request().postDataJSON().action;
      owner = action === "logout" ? null : alice;
      const result = owner;
      if (options.holdPost) await heldPost.promise;
      return fulfill(route, { account: result });
    }
    gets++;
    if (!allowGets) await heldGet.promise;
    return fulfill(route, { account: owner });
  });
  await page.addInitScript(
    ({ trip, tripKey }) => {
      if (!localStorage.getItem(tripKey)) localStorage.setItem(tripKey, JSON.stringify(trip));
    },
    { trip, tripKey },
  );
  return {
    trip,
    unexpected,
    heldGet,
    heldPost,
    allowGets() {
      allowGets = true;
    },
    get posts() {
      return posts;
    },
    get gets() {
      return gets;
    },
    switchOwner(next: typeof alice | null) {
      owner = next;
    },
  };
}
async function fulfill(route: Route, json: unknown) {
  try {
    await route.fulfill({ json });
  } catch {
    /* The request was deliberately cancelled. */
  }
}
async function signIn(page: Page, reference = false) {
  if (reference) {
    await page.getByRole("button", { name: "Guest Menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Sign in", exact: true }).click();
  } else await page.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tastip account", exact: true });
  await dialog.getByLabel("Account username", { exact: true }).fill(alice.username);
  await dialog.getByLabel("Account password", { exact: true }).fill("Synthetic-password-401");
  return dialog;
}
async function noMigratedDraft(page: Page) {
  expect(
    await page.evaluate(
      ({ tripKey, alice, bob }) => ({
        guest: localStorage.getItem(tripKey) !== null,
        alice: localStorage.getItem(`${tripKey}:${alice.id}`),
        bob: localStorage.getItem(`${tripKey}:${bob.id}`),
      }),
      { tripKey, alice, bob },
    ),
  ).toEqual({ guest: true, alice: null, bob: null });
}

test("initial account timeout exposes Retry and a later check reopens the workspace", async ({
  page,
}) => {
  const f = await fixture(page, { holdGet: true });
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => f.gets).toBeGreaterThanOrEqual(1);
  await page.clock.fastForward(15_100);
  await expect(
    page.getByRole("alert").filter({ hasText: "sign-in could not be checked" }),
  ).toContainText("sign-in could not be checked");
  f.allowGets();
  await page.getByRole("button", { name: "Retry sign-in check", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in to Tastip", exact: true })).toBeEnabled();
  f.heldGet.release();
  expect(f.posts).toBe(0);
  expect(f.unexpected).toEqual([]);
});

for (const cancel of ["Escape", "Close"] as const) {
  test(`${cancel} cancels a held sign-in, reconciles its possible cookie and does not migrate a draft`, async ({
    page,
  }) => {
    const f = await fixture(page, { holdPost: true });
    await page.goto("/");
    const dialog = await signIn(page);
    await dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
    await expect.poll(() => f.posts).toBe(1);
    await expect(dialog.getByLabel("Account username", { exact: true })).toBeDisabled();
    await expect(dialog.getByRole("checkbox")).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Create account", exact: true }),
    ).toBeDisabled();
    // A second form submit in the same pending attempt must not create another auth write.
    await dialog.locator("form").dispatchEvent("submit");
    expect(f.posts).toBe(1);
    if (cancel === "Escape") await page.keyboard.press("Escape");
    else await dialog.getByRole("button", { name: "Close account", exact: true }).click();
    await expect(dialog).toBeHidden();
    await expect(
      page.getByRole("button", { name: `Account ${alice.username}`, exact: true }),
    ).toBeVisible();
    f.heldPost.release();
    await noMigratedDraft(page);
    expect(f.unexpected).toEqual([]);
  });
}

test("a stalled POST JSON body times out without consuming or migrating the guest draft", async ({
  page,
}) => {
  const f = await fixture(page);
  await page.addInitScript(() => {
    const original = window.fetch;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/account" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => new Promise(() => {}) } as Response);
      }
      return original(input, init);
    }) as typeof window.fetch;
  });
  await page.clock.install();
  await page.goto("/");
  const dialog = await signIn(page);
  await dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  await expect(dialog.getByLabel("Account username", { exact: true })).toBeDisabled();
  await page.clock.fastForward(15_100);
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("alert").filter({ hasText: "too long to respond" })).toContainText(
    "too long to respond",
  );
  const checks = f.gets;
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect.poll(() => f.gets).toBeGreaterThan(checks);
  await expect(page.getByRole("button", { name: "Sign in to Tastip", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Retry sign-in check", exact: true }).click();
  await expect(page.getByRole("button", { name: "Sign in to Tastip", exact: true })).toBeEnabled();
  await noMigratedDraft(page);
  expect(f.unexpected).toEqual([]);
});

test("external account switch invalidates a pending sign-in before any old draft handoff", async ({
  page,
}) => {
  const f = await fixture(page, { holdPost: true });
  await page.goto("/");
  const dialog = await signIn(page);
  await dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  await expect.poll(() => f.posts).toBe(1);
  f.switchOwner(bob);
  await page.evaluate(
    (key) =>
      window.dispatchEvent(new StorageEvent("storage", { key, newValue: "synthetic-other-tab" })),
    sessionKey,
  );
  await expect(dialog).toBeHidden();
  f.heldPost.release();
  await expect(
    page.getByRole("button", { name: `Account ${bob.username}`, exact: true }),
  ).toBeVisible();
  await noMigratedDraft(page);
  expect(f.unexpected).toEqual([]);
});

test("cancelling reference media retention prevents late copied bytes, draft rebinding and identity callbacks", async ({
  page,
}) => {
  const f = await fixture(page, { media: true });
  await page.addInitScript(() => {
    const state = { opens: 0, transactions: 0, closed: 0, release: () => {} };
    Object.assign(window, { syntheticMedia: state });
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((name: string, version?: number) => {
      if (name !== "tastip-private-media") return original(name, version);
      state.opens++;
      const request = {
        onsuccess: null as (() => void) | null,
        result: {
          close() {
            state.closed++;
          },
          transaction() {
            state.transactions++;
            throw new Error("Cancelled media must not start a transaction");
          },
        },
      };
      state.release = () => request.onsuccess?.();
      return request as unknown as IDBOpenDBRequest;
    }) as typeof indexedDB.open;
  });
  await page.goto("/discover");
  const dialog = await signIn(page, true);
  await dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { syntheticMedia: { opens: number } }).syntheticMedia.opens,
      ),
    )
    .toBe(1);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: `${alice.username} Menu`, exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => {
      const state = (
        window as unknown as {
          syntheticMedia: { release(): void; transactions: number; closed: number };
        }
      ).syntheticMedia;
      state.release();
      return { transactions: state.transactions, closed: state.closed };
    }),
  ).toEqual({ transactions: 0, closed: 1 });
  await noMigratedDraft(page);
  expect(f.unexpected).toEqual([]);
});

test("sidebar logout has one bounded attempt and reconciles a stalled response", async ({
  page,
}) => {
  const f = await fixture(page, { owner: alice, holdPost: true });
  await page.clock.install();
  await page.goto("/discover");
  await page.getByRole("button", { name: `${alice.username} Menu`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect.poll(() => f.posts).toBe(1);
  await page.getByRole("button", { name: `${alice.username} Menu`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  expect(f.posts).toBe(1);
  await page.clock.fastForward(15_100);
  await expect(page.getByRole("alert").filter({ hasText: "too long to respond" })).toContainText(
    "too long to respond",
  );
  await page.getByRole("button", { name: "Retry sign-in check", exact: true }).click();
  await expect(page.getByRole("button", { name: "Guest Menu", exact: true })).toBeVisible();
  f.heldPost.release();
  expect(f.unexpected).toEqual([]);
});

test("a concurrent account draft saved during media retention wins without replacing the guest original", async ({
  page,
}) => {
  const f = await fixture(page, { media: true });
  const concurrent = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  concurrent.title = "Synthetic concurrent account draft";
  await page.addInitScript(() => {
    const state = { opens: 0, release: () => {} };
    Object.assign(window, { syntheticMedia: state });
    const original = indexedDB.open.bind(indexedDB);
    indexedDB.open = ((name: string, version?: number) => {
      if (name !== "tastip-private-media") return original(name, version);
      state.opens++;
      const request = { onerror: null as (() => void) | null };
      // A missing synthetic guest file is a supported retention outcome. Delay it
      // so a real second tab can populate the target cache during the await.
      state.release = () => request.onerror?.();
      return request as unknown as IDBOpenDBRequest;
    }) as typeof indexedDB.open;
  });
  await page.goto("/discover");
  const dialog = await signIn(page, true);
  await dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as unknown as { syntheticMedia: { opens: number } }).syntheticMedia.opens,
      ),
    )
    .toBe(1);
  const original = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key) ?? "null"),
    tripKey,
  );
  const writer = await page.context().newPage();
  await writer.route("**/*", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<title>Synthetic account cache writer</title>",
    }),
  );
  await writer.goto(new URL("/synthetic-cache-writer", page.url()).href);
  await writer.evaluate(
    ({ tripKey, alice, concurrent }) => {
      localStorage.setItem(`${tripKey}:${alice.id}`, JSON.stringify(concurrent));
    },
    { tripKey, alice, concurrent },
  );
  await page.evaluate(() =>
    (window as unknown as { syntheticMedia: { release(): void } }).syntheticMedia.release(),
  );
  await expect(dialog).toBeHidden();
  await expect(
    page.getByRole("button", { name: `${alice.username} Menu`, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Another tab saved an account draft" }),
  ).toContainText("guest original were kept");
  const retained = await page.evaluate(
    ({ tripKey, alice }) => ({
      guest: JSON.parse(localStorage.getItem(tripKey) ?? "null"),
      account: JSON.parse(localStorage.getItem(`${tripKey}:${alice.id}`) ?? "null"),
    }),
    { tripKey, alice },
  );
  expect(retained.guest).toEqual(original);
  expect(retained.account).toEqual(concurrent);
  expect(f.unexpected).toEqual([]);
  await writer.close();
});
