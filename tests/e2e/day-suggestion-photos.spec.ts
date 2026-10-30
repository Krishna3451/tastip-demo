import { expect, type Page, test } from "@playwright/test";
import {
  createTripFromPlaces,
  DEFAULT_BRIEF,
  type Place,
  type Trip,
} from "../../packages/domain/src";

const imageHost = "https://images.qloo.com/";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);
const favorite = {
  id: "00000000-0000-4000-8000-000000000294",
  name: "Synthetic day photo favorite",
  type: "urn:entity:artist",
};
function candidates(): Place[] {
  return [9, 2, 4].map((rank) => ({
    id: `synthetic-day-photo-${rank}`,
    destinationId: "lisbon",
    name: `Synthetic day photo place ${rank}`,
    description: "Synthetic Qloo photo regression fixture, not a real venue.",
    category: "culture",
    source: "qloo",
    lat: 38.72,
    lng: -9.13,
    taste: { queryId: "synthetic-day-photo-query", rank },
    practical: { hours: "unknown", cost: "unknown" },
    ...(rank !== 4
      ? {
          facts: {
            source: "qloo" as const,
            retrievedAt: "2026-10-30T00:00:00Z",
            imageUrl: `${imageHost}${rank === 9 ? "day-fixture-photo" : "day-fixture-broken"}.png`,
          },
        }
      : {}),
  }));
}
async function setup(page: Page, trip: Trip) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: true } } }),
  );
  await page.addInitScript((trip) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
  }, trip);
  const paidCalls: string[] = [];
  for (const endpoint of ["chat", "voice/session", "taste/search"]) {
    await page.route(`**/api/${endpoint}`, (route) => {
      paidCalls.push(route.request().url());
      return route.fulfill({
        status: 503,
        json: { error: { message: "Unexpected synthetic provider request." } },
      });
    });
  }
  return paidCalls;
}
async function openTray(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true })
    .click();
  const chat = page.getByRole("region", { name: "Planner chat", exact: true });
  await chat.getByRole("button", { name: "Places for Day 1", exact: true }).click();
  return chat.getByRole("region", { name: "Suggestions for this day", exact: true });
}
function stored(page: Page): Promise<Trip> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}
function tripWith(place: Place) {
  return createTripFromPlaces(
    {
      ...DEFAULT_BRIEF,
      days: 1,
      tasteProfile: { seeds: [favorite], categories: [], dayStyle: "Art and cafés" },
    },
    [place],
  );
}
for (const width of [375, 1440]) {
  test(`day suggestion photos retain credit, map fallbacks and reviewed repeat-visit evidence at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const places = candidates();
    const first = places[0]!;
    const broken = places[1]!;
    const missing = places[2]!;
    const previous = tripWith(first);
    const paidCalls = await setup(page, previous);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const images: string[] = [];
    await page.route(`${imageHost}**`, (route) => {
      images.push(route.request().url());
      expect(route.request().headers().referer).toBeUndefined();
      return route.request().url().includes("broken")
        ? route.fulfill({ status: 404, body: "Synthetic unavailable photo" })
        : route.fulfill({ contentType: "image/png", body: image });
    });
    let calls = 0;
    await page.route("**/api/taste", (route) => {
      calls++;
      expect(route.request().postDataJSON()).toMatchObject({
        entityIds: [favorite.id],
        destinationId: "lisbon",
        radiusMetres: 8000,
      });
      return route.fulfill({
        json: {
          provider: "qloo",
          queryId: "synthetic-day-photo-query",
          selected: places,
          warnings: [],
        },
      });
    });
    await page.goto("/home?day=day-1");
    const tray = await openTray(page);
    expect(calls).toBe(0);
    await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
    await expect(tray.getByRole("status")).toContainText(
      "3 Qloo suggestions · review before adding",
    );
    await expect(tray.getByRole("article").getByRole("heading", { level: 4 })).toHaveText(
      places.map((place) => place.name),
    );
    const photoCard = tray.getByRole("article").filter({ hasText: first.name });
    const photo = photoCard.getByRole("img", {
      name: `${first.name} — supplied via Qloo`,
      exact: true,
    });
    await expect(photo).toHaveAttribute("src", first.facts!.imageUrl!);
    await expect(photo).toHaveAttribute("referrerpolicy", "no-referrer");
    await expect(photo).toHaveJSProperty("naturalWidth", 1);
    await expect(photoCard.getByText("Image via Qloo", { exact: true })).toBeVisible();
    await expect(photoCard).toContainText("Qloo · original rank 9");
    await expect(photoCard).toContainText("Already planned on this day");
    const repeat = photoCard.getByRole("button", {
      name: `Review ${first.name} for Day 1`,
      exact: true,
    });
    await expect(repeat).toHaveText("Add another visit");
    const failedCard = tray.getByRole("article").filter({ hasText: broken.name });
    await failedCard.scrollIntoViewIfNeeded();
    await expect.poll(() => images.includes(broken.facts!.imageUrl!)).toBe(true);
    await expect(failedCard.locator("img")).toHaveCount(0);
    await expect(failedCard.locator("svg").first()).toBeVisible();
    await expect(failedCard).not.toContainText("Image via Qloo");
    await expect(failedCard).not.toContainText("Already planned on this day");
    await expect(
      failedCard.getByRole("button", { name: `Review ${broken.name} for Day 1`, exact: true }),
    ).toHaveText("Add to Day 1");
    const missingCard = tray.getByRole("article").filter({ hasText: missing.name });
    await missingCard.scrollIntoViewIfNeeded();
    await expect(missingCard.locator("img")).toHaveCount(0);
    await expect(missingCard.locator("svg").first()).toBeVisible();
    await expect(missingCard).not.toContainText("Image via Qloo");
    expect(await stored(page)).toEqual(previous);
    // Failure to load a photo must not prevent reviewing the underlying real candidate.
    await failedCard
      .getByRole("button", { name: `Review ${broken.name} for Day 1`, exact: true })
      .click();
    const review = page.getByRole("dialog", { name: "Add place to trip", exact: true });
    await expect(review.getByRole("heading", { name: broken.name, exact: true })).toBeVisible();
    await review.getByRole("button", { name: "Close", exact: true }).click();
    expect(await stored(page)).toEqual(previous);
    await photoCard.scrollIntoViewIfNeeded();
    await photoCard.getByText("Recommendation source", { exact: true }).click();
    await expect(photoCard).toContainText(first.taste!.queryId);
    await page.screenshot({
      path: test.info().outputPath(`day-suggestion-photo-${width}.png`),
      fullPage: true,
    });
    await repeat.click();
    await expect(review.getByLabel("Place visit day", { exact: true })).toHaveValue("day-1");
    await review.getByLabel("Place visit start time", { exact: true }).fill("14:30");
    await review.getByLabel("Place visit duration", { exact: true }).fill("45");
    await review.getByRole("button", { name: "Add visit", exact: true }).click();
    await expect.poll(async () => (await stored(page)).version).toBe(previous.version + 1);
    const accepted = await stored(page);
    expect(accepted.stops).toHaveLength(previous.stops.length + 1);
    expect(
      accepted.stops.find((stop) => !previous.stops.some((old) => old.id === stop.id)),
    ).toMatchObject({
      dayId: "day-1",
      placeId: first.id,
      startTime: "14:30",
      durationMinutes: 45,
      selection: first.taste,
    });
    expect(accepted.places).toEqual(previous.places);
    expect(accepted.route).toEqual(previous.route);
    expect(accepted.places[0]?.facts).toEqual(first.facts);
    expect(calls).toBe(1);
    expect(paidCalls).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("day suggestions reject an untrusted photo host before any image request or trip edit", async ({
  page,
}) => {
  const places = candidates();
  const previous = structuredClone(tripWith(places[0]!));
  const paidCalls = await setup(page, previous);
  const untrusted = "https://untrusted.invalid/synthetic-photo.png";
  places[0]!.facts!.imageUrl = untrusted;
  const untrustedRequests: string[] = [];
  await page.route("https://untrusted.invalid/**", (route) => {
    untrustedRequests.push(route.request().url());
    return route.fulfill({ contentType: "image/png", body: image });
  });
  // Existing accepted data uses its own valid source, independent of the rejected response.
  await page.route(`${imageHost}**`, (route) =>
    route.fulfill({ contentType: "image/png", body: image }),
  );
  let calls = 0;
  await page.route("**/api/taste", (route) => {
    calls++;
    return route.fulfill({
      json: {
        provider: "qloo",
        queryId: "synthetic-day-photo-query",
        selected: places,
        warnings: [],
      },
    });
  });
  await page.goto("/home?day=day-1");
  const tray = await openTray(page);
  await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
  await expect(tray.getByRole("alert")).toContainText("could not be verified");
  await expect(tray.getByRole("article")).toHaveCount(0);
  expect(untrustedRequests).toEqual([]);
  expect(await stored(page)).toEqual(previous);
  expect(calls).toBe(1);
  expect(paidCalls).toEqual([]);
});
