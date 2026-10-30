import { expect, type Page, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF, type Place, type Trip } from "../../packages/domain/src";

const seed = {
  id: "00000000-0000-4000-8000-000000000001",
  name: "Synthetic entry artist",
  type: "urn:entity:artist",
};
function candidates(city: string): Place[] {
  return [9, 1, 7, 3, 12, 5].map((rank) => ({
    id: `${city}-entry-${rank}`,
    destinationId: city,
    name: `Synthetic ${city} place ${rank}`,
    description: "Synthetic entry review fixture, not a real venue.",
    source: "qloo",
    category: "culture",
    lat: city === "porto" ? 41.15 : 38.72,
    lng: city === "porto" ? -8.62 : -9.13,
    taste: { queryId: `${city}-entry-query`, rank },
    practical: { hours: "unknown", cost: "unknown" },
  }));
}
async function entryReview(page: Page) {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: false } } }),
  );
  await page.route("**/api/taste/search", (route) => route.fulfill({ json: { results: [seed] } }));
  await page.goto("/studio");
  await page.getByText("Describe a route", { exact: true }).click();
  await page
    .getByLabel("Describe your trip", { exact: true })
    .fill("4 days in Lisbon and Porto for 2 travelers, with art and food.");
  await page.getByRole("button", { name: "Sketch my route", exact: true }).click();
  const routeReview = page.getByRole("form", { name: "Review interpreted trip", exact: true });
  await routeReview.getByLabel("Prompt start date", { exact: true }).fill("2028-11-15");
  await routeReview.getByRole("button", { name: "Use this route", exact: true }).click();
  await page.getByRole("button", { name: "Find my kind of places", exact: true }).click();
  const taste = page.getByRole("dialog", { name: "Create your taste-led trip", exact: true });
  await taste.getByLabel("Search a cultural favorite").fill("Synthetic entry artist");
  await taste.getByRole("button", { name: "Search favorites", exact: true }).click();
  await taste.getByRole("button", { name: /Synthetic entry artist.*artist/ }).click();
  await taste.getByRole("button", { name: "Continue", exact: true }).click();
  await taste.getByRole("button", { name: "A little of everything", exact: true }).click();
  await taste.getByRole("button", { name: "Continue", exact: true }).click();
  await taste.getByRole("button", { name: "Continue", exact: true }).click();
  await taste.getByRole("button", { name: "Build with my taste", exact: true }).click();
  return page.getByRole("dialog", { name: "Review your personal trip", exact: true });
}
async function stored(page: Page): Promise<Trip | null> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}
for (const width of [375, 1440]) {
  test(`entry taste reviews all route cities before acceptance at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    const seen: string[] = [];
    const archived = JSON.stringify([createDemoTrip(DEFAULT_BRIEF)]);
    await page.addInitScript((value) => {
      if (!localStorage.getItem("tastip.library.v1"))
        localStorage.setItem("tastip.library.v1", value);
    }, archived);
    await page.route("**/api/taste", (route) => {
      const body = route.request().postDataJSON();
      seen.push(body.destinationId);
      expect(body.entityIds).toEqual([seed.id]);
      expect(body.destination.id).toBe(body.destinationId);
      return route.fulfill({ json: { selected: candidates(body.destinationId), warnings: [] } });
    });
    const review = await entryReview(page);
    await expect(review).toBeVisible();
    expect(seen).toEqual([]);
    expect(await stored(page)).toBeNull();
    await review.getByRole("button", { name: "Find my places", exact: true }).click();
    await expect(
      review.getByRole("region", { name: "Proposed itinerary", exact: true }),
    ).toBeVisible();
    expect(seen).toEqual(["lisbon", "porto"]);
    expect(await stored(page)).toBeNull();
    await review.getByRole("button", { name: "Create this trip", exact: true }).click();
    await expect(review).not.toBeVisible();
    const trip = await stored(page);
    if (!trip) throw new Error("Expected an accepted trip");
    expect(trip.days.map((day) => day.date)).toEqual([
      "2028-11-15",
      "2028-11-16",
      "2028-11-17",
      "2028-11-18",
    ]);
    expect(await page.evaluate(() => localStorage.getItem("tastip.library.v1"))).toBe(archived);
    expect(trip.brief.partySize).toBe(2);
    expect(trip.brief.tasteProfile?.seeds).toEqual([seed]);
    for (const day of trip.days)
      expect(trip.stops.some((stop) => stop.dayId === day.id)).toBe(true);
    for (const stop of trip.stops) {
      const place = trip.places.find((place) => place.id === stop.placeId);
      expect(stop.selection).toEqual(place?.taste);
      expect(stop.selection?.queryId).toBe(`${place?.destinationId}-entry-query`);
    }
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await page.reload();
    expect((await stored(page))?.id).toBe(trip.id);
  });
}
test("entry failure keeps completed city evidence for retry and creates nothing early", async ({
  page,
}) => {
  const seen: string[] = [];
  await page.route("**/api/taste", (route) => {
    const city = route.request().postDataJSON().destinationId;
    seen.push(city);
    return route.fulfill(
      city === "porto" && seen.length === 2
        ? { status: 503, json: { error: { message: "Synthetic Porto interruption" } } }
        : { json: { selected: candidates(city), warnings: [] } },
    );
  });
  const review = await entryReview(page);
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Synthetic Porto interruption");
  expect(await stored(page)).toBeNull();
  await expect(review.getByRole("button", { name: "Create this trip", exact: true })).toHaveCount(
    0,
  );
  await review.getByRole("button", { name: "Retry planning", exact: true }).click();
  await expect(
    review.getByRole("region", { name: "Proposed itinerary", exact: true }),
  ).toBeVisible();
  expect(seen).toEqual(["lisbon", "porto", "porto"]);
  expect(await stored(page)).toBeNull();
  await page.keyboard.press("Escape");
  await expect(review).not.toBeVisible();
  expect(await stored(page)).toBeNull();
});
test("closing entry generation aborts late city output without accepting a partial trip", async ({
  page,
}) => {
  let finish: (() => void) | undefined;
  let aborted = false;
  page.on("requestfailed", (request) => {
    if (request.url().endsWith("/api/taste")) aborted = true;
  });
  await page.route("**/api/taste", async (route) => {
    const city = route.request().postDataJSON().destinationId;
    if (city === "porto")
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    await route.fulfill({ json: { selected: candidates(city), warnings: [] } }).catch(() => {});
  });
  const review = await entryReview(page);
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(review).not.toBeVisible();
  finish?.();
  await expect.poll(() => aborted).toBe(true);
  expect(await stored(page)).toBeNull();
});

test("a changed account aborts entry generation and never gives the next owner its preview", async ({
  page,
}) => {
  const alice = { id: "00000000-0000-4000-8000-000000000091", username: "entry-fixture-alice" };
  const bob = { id: "00000000-0000-4000-8000-000000000092", username: "entry-fixture-bob" };
  let account = alice;
  await page.route("**/api/account", (route) => route.fulfill({ json: { account } }));
  await page.route("**/api/profile", (route) =>
    route.fulfill({ json: { profile: null, revision: 0 } }),
  );
  let finish: (() => void) | undefined;
  await page.route("**/api/taste", async (route) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await route.fulfill({ json: { selected: candidates("lisbon"), warnings: [] } }).catch(() => {});
  });
  const review = await entryReview(page);
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  account = bob;
  await page.evaluate(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "tastip.session.change.v1" })),
  );
  await expect(review).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Account entry-fixture-bob", exact: true }),
  ).toBeVisible();
  finish?.();
  expect(
    await page.evaluate(
      (ids) => ids.map((id) => localStorage.getItem(`tastip.trip.v1:${id}`)),
      [alice.id, bob.id],
    ),
  ).toEqual([null, null]);
  await expect(page.getByRole("region", { name: "Proposed itinerary", exact: true })).toHaveCount(
    0,
  );
});

test("back returns to entry details while keeping confirmed favorites without any recommendation call", async ({
  page,
}) => {
  let requests = 0;
  await page.route("**/api/taste", (route) => {
    requests++;
    return route.abort();
  });
  const review = await entryReview(page);
  await review.getByRole("button", { name: "Back to trip details", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByText(/Route ready · Lisbon → Porto/)).toBeVisible();
  await page.getByRole("button", { name: "Find my kind of places", exact: true }).click();
  const taste = page.getByRole("dialog", { name: "Create your taste-led trip", exact: true });
  await expect(taste.getByText(seed.name, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  expect(requests).toBe(0);
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
});
