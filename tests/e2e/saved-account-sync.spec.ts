import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import { DESTINATIONS, type Place } from "../../packages/domain/src";
import { E2E_ORIGIN } from "./environment";

const fixture: Place = {
  id: "saved-cloud-fixture",
  destinationId: "lisbon",
  name: "Synthetic cloud-saved place",
  description: "Synthetic saved-sync fixture, not a live venue.",
  category: "culture",
  lat: 38.72,
  lng: -9.13,
  source: "qloo",
  taste: { queryId: "cloud-query-fixture", rank: 7 },
  practical: { hours: "unknown", cost: "unknown" },
};
const collectionId = "00000000-0000-4000-8000-000000000079";
const password = "Synthetic-saved-password-7419";
async function register(context: BrowserContext) {
  const username = `saved_${crypto.randomUUID().slice(0, 12)}`;
  const response = await context.request.post(`${E2E_ORIGIN}/api/account`, {
    headers: { Origin: E2E_ORIGIN },
    data: { action: "register", username, password },
  });
  expect(response.ok()).toBe(true);
  return { ...(await response.json()).account, username };
}
async function read(context: BrowserContext, id: string) {
  return (
    await context.request.get(`${E2E_ORIGIN}/api/saved`, { headers: { "X-Tastip-Account": id } })
  ).json();
}
async function createCollection(page: Page, name: string) {
  await page.getByRole("button", { name: "Create", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Create a collection", exact: true });
  await dialog.getByRole("textbox").fill(name);
  await dialog.getByRole("button", { name: "Create", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}
test("legacy owner saves migrate once and reopen on another device with source evidence and memberships", async ({
  browser,
  context,
  page,
}) => {
  const account = await register(context);
  await page.addInitScript(
    ({ id, place, destination, collectionId }) => {
      if (!localStorage.getItem(`tastip.reference.saved:${id}`)) {
        localStorage.setItem(
          `tastip.reference.saved:${id}`,
          JSON.stringify([{ place, destination }]),
        );
        localStorage.setItem(
          `tastip.reference.collections:${id}`,
          JSON.stringify([
            { id: collectionId, name: "Cloud museum list", placeIds: [place.id, "legacy-orphan"] },
          ]),
        );
      }
    },
    { id: account.id, place: fixture, destination: DESTINATIONS[0]!, collectionId },
  );
  await page.goto("/saved");
  await expect.poll(async () => (await read(context, account.id)).revision).toBe(1);
  const migrated = await read(context, account.id);
  expect(migrated.workspace.places[0]).toEqual({ place: fixture, destination: DESTINATIONS[0] });
  expect(migrated.workspace.collections[0].placeIds).toEqual([fixture.id, "legacy-orphan"]);
  const other = await browser.newContext();
  try {
    await other.request.post(`${E2E_ORIGIN}/api/account`, {
      headers: { Origin: E2E_ORIGIN },
      data: { action: "login", username: account.username, password },
    });
    const next = await other.newPage();
    await next.goto(`/saved?collection=${collectionId}`);
    await expect(
      next.getByRole("heading", { name: "Cloud museum list", exact: true }),
    ).toBeVisible();
    await next.getByRole("button", { name: `View ${fixture.name}`, exact: true }).click();
    await expect(next.getByRole("dialog", { name: fixture.name, exact: true })).toContainText(
      "Place details via Qloo",
    );
    expect((await read(other, account.id)).workspace.places[0].place.taste).toEqual(fixture.taste);
    await page.reload();
    expect((await read(context, account.id)).revision).toBe(1);
  } finally {
    await other.close();
  }
});
test("concurrent devices keep a stale draft for explicit conflict review and combination", async ({
  browser,
  context,
  page,
}) => {
  const account = await register(context);
  await page.goto("/saved");
  await createCollection(page, "Initial list");
  await expect.poll(async () => (await read(context, account.id)).revision).toBe(1);
  const other = await browser.newContext();
  try {
    await other.request.post(`${E2E_ORIGIN}/api/account`, {
      headers: { Origin: E2E_ORIGIN },
      data: { action: "login", username: account.username, password },
    });
    const next = await other.newPage();
    await next.goto("/saved");
    await expect(next.getByRole("button", { name: /^Initial list/ })).toBeVisible();
    await createCollection(page, "First device list");
    await expect.poll(async () => (await read(context, account.id)).revision).toBe(2);
    await createCollection(next, "Second device list");
    await expect(
      next.getByRole("region", { name: "Saved storage", exact: true }).getByRole("alert"),
    ).toContainText(/changed|another/i);
    expect(
      (await read(other, account.id)).workspace.collections.map(
        (item: { name: string }) => item.name,
      ),
    ).not.toContain("Second device list");
    await next.getByRole("button", { name: "Review account saves", exact: true }).click();
    const review = next.getByRole("dialog", { name: "Review account saves", exact: true });
    await review.getByRole("button", { name: "Combine both copies", exact: true }).click();
    await expect.poll(async () => (await read(other, account.id)).revision).toBe(3);
    expect(
      (await read(other, account.id)).workspace.collections
        .map((item: { name: string }) => item.name)
        .sort(),
    ).toEqual(["First device list", "Initial list", "Second device list"]);
    expect(
      await next.evaluate(
        (id) => localStorage.getItem(`tastip.reference.saved-recovery:${id}`),
        account.id,
      ),
    ).toContain("Second device list");
  } finally {
    await other.close();
  }
});
test("cleared account saves do not resurrect from the old device cache", async ({
  context,
  page,
}) => {
  const account = await register(context);
  await page.goto("/saved");
  await createCollection(page, "Clear fixture list");
  await expect.poll(async () => (await read(context, account.id)).revision).toBe(1);
  const cleared = await context.request.post(`${E2E_ORIGIN}/api/saved`, {
    headers: { Origin: E2E_ORIGIN, "X-Tastip-Account": account.id },
    data: { action: "clear", expectedRevision: 1 },
  });
  expect(cleared.ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Your collections", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Clear fixture list/ })).toHaveCount(0);
  expect((await read(context, account.id)).revision).toBe(2);
  expect((await read(context, account.id)).workspace).toBeNull();
});
test("a failed write survives reload and can be combined without losing the account copy", async ({
  context,
  page,
}) => {
  const account = await register(context);
  await page.goto("/saved");
  await createCollection(page, "Original account list");
  await expect.poll(async () => (await read(context, account.id)).revision).toBe(1);
  await page.route("**/api/saved", async (route) =>
    route.request().method() === "POST"
      ? route.fulfill({ status: 503, json: { error: { message: "Synthetic sync interruption" } } })
      : route.continue(),
  );
  await createCollection(page, "Offline device list");
  await expect(
    page.getByRole("region", { name: "Saved storage", exact: true }).getByRole("alert"),
  ).toContainText("Synthetic sync interruption");
  await page.reload();
  const review = page.getByRole("dialog", { name: "Review account saves", exact: true });
  await expect(review).toBeVisible();
  await page.unroute("**/api/saved");
  await review.getByRole("button", { name: "Combine both copies", exact: true }).click();
  await expect.poll(async () => (await read(context, account.id)).revision).toBe(2);
  expect(
    (await read(context, account.id)).workspace.collections
      .map((item: { name: string }) => item.name)
      .sort(),
  ).toEqual(["Offline device list", "Original account list"]);
});
