import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { DESTINATIONS, type Place } from "../../packages/domain/src";
import { E2E_ORIGIN } from "./environment";

const remoteCollection = {
  id: "00000000-0000-4000-8000-000000000087",
  name: "Recovery account collection",
  placeIds: [] as string[],
};
const pendingCollection = {
  id: "00000000-0000-4000-8000-000000000088",
  name: "Recovery pending collection",
  placeIds: ["saved-recovery-fixture"],
};
const place: Place = {
  id: "saved-recovery-fixture",
  destinationId: "lisbon",
  name: "Synthetic pending saved place",
  description: "Synthetic saved-recovery fixture, not a live venue.",
  source: "qloo",
  category: "culture",
  lat: 38.72,
  lng: -9.13,
  taste: { queryId: "saved-recovery-query", rank: 7 },
  practical: { hours: "unknown", cost: "unknown" },
};
const remoteWorkspace = { places: [], collections: [remoteCollection] };
const pendingWorkspace = {
  places: [{ place, destination: DESTINATIONS[0]! }],
  collections: [pendingCollection],
};

async function register(context: BrowserContext) {
  const response = await context.request.post(`${E2E_ORIGIN}/api/account`, {
    headers: { Origin: E2E_ORIGIN },
    data: {
      action: "register",
      username: `recovery_${crypto.randomUUID().slice(0, 12)}`,
      password: "Synthetic-recovery-password-7528",
    },
  });
  expect(response.ok()).toBe(true);
  const account = (await response.json()).account;
  const saved = await context.request.post(`${E2E_ORIGIN}/api/saved`, {
    headers: { Origin: E2E_ORIGIN, "X-Tastip-Account": account.id },
    data: { action: "save", workspace: remoteWorkspace, expectedRevision: 0 },
  });
  expect(saved.ok()).toBe(true);
  return account as { id: string; username: string };
}
async function read(context: BrowserContext, id: string) {
  const response = await context.request.get(`${E2E_ORIGIN}/api/saved`, {
    headers: { "X-Tastip-Account": id },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
function postedSaves(page: Page) {
  const requests: unknown[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname === "/api/saved")
      requests.push(request.postDataJSON());
  });
  return requests;
}

test("a valid pending account draft survives malformed legacy caches and combines without overwriting their raw bytes", async ({
  context,
  page,
}) => {
  const account = await register(context);
  const malformedPlaces = "{synthetic unreadable legacy places";
  const malformedCollections = "{synthetic unreadable legacy collections";
  await page.addInitScript(
    ({ id, pending, malformedPlaces, malformedCollections }) => {
      localStorage.setItem(`tastip.reference.saved:${id}`, malformedPlaces);
      localStorage.setItem(`tastip.reference.collections:${id}`, malformedCollections);
      // An origin copy already exists: compatibility mirroring must still check raw legacy bytes.
      localStorage.setItem(
        `tastip.reference.saved-origin:${id}`,
        JSON.stringify({ places: [], collections: [] }),
      );
      if (!localStorage.getItem(`tastip.reference.saved-draft:${id}`))
        localStorage.setItem(
          `tastip.reference.saved-draft:${id}`,
          JSON.stringify({ workspace: pending, revision: 0 }),
        );
    },
    { id: account.id, pending: pendingWorkspace, malformedPlaces, malformedCollections },
  );
  const posts = postedSaves(page);
  await page.goto("/saved");
  const review = page.getByRole("dialog", { name: "Review account saves", exact: true });
  await expect(review).toContainText("Device copy: 1 places · 1 collections.");
  expect(posts).toHaveLength(0);
  expect((await read(context, account.id)).revision).toBe(1);
  await review.getByRole("button", { name: "Combine both copies", exact: true }).click();
  await expect.poll(async () => (await read(context, account.id)).revision).toBe(2);
  const saved = await read(context, account.id);
  expect(saved.workspace.places).toEqual(pendingWorkspace.places);
  expect(saved.workspace.collections.map((item: { name: string }) => item.name).sort()).toEqual(
    [remoteCollection.name, pendingCollection.name].sort(),
  );
  expect(posts).toHaveLength(1);
  const copies = await page.evaluate(
    (id) => ({
      places: localStorage.getItem(`tastip.reference.saved:${id}`),
      collections: localStorage.getItem(`tastip.reference.collections:${id}`),
      recovery: localStorage.getItem(`tastip.reference.saved-recovery:${id}`),
      draft: localStorage.getItem(`tastip.reference.saved-draft:${id}`),
    }),
    account.id,
  );
  expect(copies.places).toBe(malformedPlaces);
  expect(copies.collections).toBe(malformedCollections);
  expect(JSON.parse(copies.recovery ?? "null")).toEqual(pendingWorkspace);
  expect(copies.draft).toBeNull();
});

test("an unreadable pending draft blocks writes until explicit account-copy recovery preserves its raw bytes", async ({
  context,
  page,
}) => {
  const account = await register(context);
  const rawDraft = "{synthetic incomplete unsynced draft";
  await page.addInitScript(
    ({ id, rawDraft }) => {
      if (!localStorage.getItem(`tastip.reference.saved-recovery:${id}:unreadable-draft`))
        localStorage.setItem(`tastip.reference.saved-draft:${id}`, rawDraft);
    },
    { id: account.id, rawDraft },
  );
  const posts = postedSaves(page);
  await page.goto("/saved");
  const review = page.getByRole("dialog", { name: "Review account saves", exact: true });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Combine both copies", exact: true }),
  ).toHaveCount(0);
  expect(posts).toHaveLength(0);
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`tastip.reference.saved-draft:${id}`),
      account.id,
    ),
  ).toBe(rawDraft);
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Review account saves", exact: true }).click();
  await review.getByRole("button", { name: "Use account copy", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  const copies = await page.evaluate(
    (id) => ({
      backup: localStorage.getItem(`tastip.reference.saved-recovery:${id}:unreadable-draft`),
      draft: localStorage.getItem(`tastip.reference.saved-draft:${id}`),
      workspace: localStorage.getItem(`tastip.reference.saved-workspace:${id}`),
    }),
    account.id,
  );
  expect(copies.backup).toBe(rawDraft);
  expect(copies.draft).toBeNull();
  expect(JSON.parse(copies.workspace ?? "null")).toEqual(remoteWorkspace);
  expect(posts).toHaveLength(0);
  expect((await read(context, account.id)).revision).toBe(1);
  await page.reload();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`tastip.reference.saved-recovery:${id}:unreadable-draft`),
      account.id,
    ),
  ).toBe(rawDraft);
  expect(posts).toHaveLength(0);
});

test("an unreadable canonical account cache is preserved before refresh without a new server write", async ({
  context,
  page,
}) => {
  const account = await register(context);
  const rawWorkspace = "{synthetic unreadable canonical workspace";
  await page.addInitScript(
    ({ id, rawWorkspace }) => {
      if (!localStorage.getItem(`tastip.reference.saved-recovery:${id}:unreadable-workspace`))
        localStorage.setItem(`tastip.reference.saved-workspace:${id}`, rawWorkspace);
    },
    { id: account.id, rawWorkspace },
  );
  const posts = postedSaves(page);
  await page.goto("/saved");
  await expect(page.getByRole("button", { name: /^Recovery account collection/ })).toBeVisible();
  const copies = await page.evaluate(
    (id) => ({
      backup: localStorage.getItem(`tastip.reference.saved-recovery:${id}:unreadable-workspace`),
      workspace: localStorage.getItem(`tastip.reference.saved-workspace:${id}`),
    }),
    account.id,
  );
  expect(copies.backup).toBe(rawWorkspace);
  expect(JSON.parse(copies.workspace ?? "null")).toEqual(remoteWorkspace);
  expect(posts).toHaveLength(0);
  expect((await read(context, account.id)).revision).toBe(1);
});

test("an earlier tab save cannot erase a newer shared pending draft when its account reply arrives", async ({
  context,
  page,
}) => {
  const account = await register(context);
  let releasePost!: () => void;
  const postGate = new Promise<void>((resolve) => {
    releasePost = resolve;
  });
  await page.route("**/api/saved", async (route) => {
    if (route.request().method() === "POST") await postGate;
    await route.continue();
  });
  const secondTab = await context.newPage();
  try {
    await page.goto("/saved");
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create a collection", exact: true });
    await create.getByRole("textbox").fill("First tab accepted collection");
    const firstPost = page.waitForRequest(
      (request) => request.method() === "POST" && new URL(request.url()).pathname === "/api/saved",
    );
    await create.getByRole("button", { name: "Create", exact: true }).click();
    const firstWorkspace = (await firstPost).postDataJSON().workspace;
    await expect(create).not.toBeVisible();
    expect((await read(context, account.id)).revision).toBe(1);

    // Both pages share storage and account cookies. The second tab has a distinct, durable edit
    // while the first tab's genuine account write is still waiting for its response.
    await secondTab.goto("/saved");
    const newerDraft = JSON.stringify({ workspace: pendingWorkspace, revision: 1 });
    await secondTab.evaluate(
      ({ id, raw }) => localStorage.setItem(`tastip.reference.saved-draft:${id}`, raw),
      { id: account.id, raw: newerDraft },
    );
    releasePost();
    await expect.poll(async () => (await read(context, account.id)).revision).toBe(2);
    await expect(
      page.getByRole("region", { name: "Saved storage", exact: true }).getByRole("status"),
    ).not.toContainText("Saving to your account");
    expect((await read(context, account.id)).workspace).toEqual(firstWorkspace);
    expect(
      await secondTab.evaluate(
        (id) => localStorage.getItem(`tastip.reference.saved-draft:${id}`),
        account.id,
      ),
    ).toBe(newerDraft);

    await page.reload();
    const review = page.getByRole("dialog", { name: "Review account saves", exact: true });
    await expect(review).toContainText("Device copy: 1 places · 1 collections.");
    expect(
      await page.evaluate(
        (id) => localStorage.getItem(`tastip.reference.saved-draft:${id}`),
        account.id,
      ),
    ).toBe(newerDraft);
    expect((await read(context, account.id)).workspace).toEqual(firstWorkspace);
    expect((await read(context, account.id)).revision).toBe(2);
  } finally {
    releasePost();
    await secondTab.close();
  }
});

test("a null-workspace local draft requires explicit recovery and retains its exact unreadable bytes", async ({
  context,
  page,
}) => {
  const account = await register(context);
  const rawDraft = '{\n  "workspace": null, "revision": 1\n}';
  await page.addInitScript(
    ({ id, rawDraft }) => localStorage.setItem(`tastip.reference.saved-draft:${id}`, rawDraft),
    { id: account.id, rawDraft },
  );
  const posts = postedSaves(page);
  await page.goto("/saved");
  const review = page.getByRole("dialog", { name: "Review account saves", exact: true });
  await expect(review).toBeVisible();
  await expect(
    review.getByRole("button", { name: "Combine both copies", exact: true }),
  ).toHaveCount(0);
  expect(posts).toHaveLength(0);
  await review.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeDisabled();
  expect(
    await page.evaluate(
      (id) => localStorage.getItem(`tastip.reference.saved-draft:${id}`),
      account.id,
    ),
  ).toBe(rawDraft);
  await page.getByRole("button", { name: "Review account saves", exact: true }).click();
  await review.getByRole("button", { name: "Use account copy", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Create", exact: true })).toBeEnabled();
  const copies = await page.evaluate(
    (id) => ({
      draft: localStorage.getItem(`tastip.reference.saved-draft:${id}`),
      backup: localStorage.getItem(`tastip.reference.saved-recovery:${id}:unreadable-draft`),
      workspace: localStorage.getItem(`tastip.reference.saved-workspace:${id}`),
    }),
    account.id,
  );
  expect(copies.draft).toBeNull();
  expect(copies.backup).toBe(rawDraft);
  expect(JSON.parse(copies.workspace ?? "null")).toEqual(remoteWorkspace);
  expect(posts).toHaveLength(0);
  expect((await read(context, account.id)).revision).toBe(1);
});
