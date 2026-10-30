import { expect, type Page, test } from "@playwright/test";
import {
  applyTripCommand,
  createTripFromPlaces,
  DEFAULT_BRIEF,
  DESTINATIONS,
  type Place,
  type TasteProfile,
  type Trip,
} from "../../packages/domain/src";
import { E2E_ORIGIN } from "./environment";

const favorite = {
  id: "00000000-0000-4000-8000-000000000018",
  name: "Discovery fixture artist",
  type: "urn:entity:artist",
};
const profile: TasteProfile = {
  seeds: [favorite],
  categories: [],
  dayStyle: "A little of everything",
};
function candidate(city: string, rank: number): Place {
  return {
    id: `${city}-discovery-${rank}`,
    destinationId: city,
    name: `${city} discovery fixture ${rank}`,
    description: "Synthetic discovery contract fixture; not a live venue.",
    category: rank % 2 ? "cafe" : "culture",
    lat: city === "porto" ? 41.15 : 38.72,
    lng: city === "porto" ? -8.62 : -9.13,
    source: "qloo",
    taste: { queryId: `${city}-discovery-query`, rank },
    practical: { hours: "unknown", cost: "unknown" },
  };
}
function draft() {
  return createTripFromPlaces({ ...DEFAULT_BRIEF, tasteProfile: profile }, []);
}
async function seed(page: Page, trip: Trip) {
  await page.addInitScript((trip) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
  }, trip);
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true } } }),
  );
}
async function stored(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}

test("Discover category survives reload and Explore separates multi-city candidates", async ({
  page,
}) => {
  const base = draft();
  const routed = applyTripCommand(base, {
    id: "discovery-multi-city",
    baseVersion: base.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: null,
          stays: [
            { id: "lisbon", destinationId: "lisbon", days: 2 },
            { id: "porto", destinationId: "porto", days: 2 },
          ],
          transfers: [
            { id: "transfer", fromStayId: "lisbon", toStayId: "porto", mode: "undecided" },
          ],
        },
      },
      { type: "add-candidates", destinationId: "lisbon", places: [candidate("lisbon", 1)] },
      { type: "add-candidates", destinationId: "porto", places: [candidate("porto", 1)] },
    ],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  await seed(page, routed.trip);
  await page.goto("/discover");
  await page.getByRole("button", { name: "Eats", exact: true }).click();
  await expect(page).toHaveURL(/explore\?type=restaurant$/);
  await expect(page.getByRole("button", { name: "Restaurants", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page.getByRole("button", { name: "View lisbon discovery fixture 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View porto discovery fixture 1", exact: true }),
  ).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("button", { name: "Restaurants", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Explore location: Lisbon", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Explore location", exact: true })
    .getByRole("button", { name: "Porto", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "View porto discovery fixture 1", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View lisbon discovery fixture 1", exact: true }),
  ).toHaveCount(0);
  expect(await stored(page)).toEqual(routed.trip);
});

for (const width of [375, 1440])
  test(`Qloo discovery preserves evidence through Save and an accepted visit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const trip = draft();
    await seed(page, trip);
    const places = Array.from({ length: 15 }, (_, index) => candidate("lisbon", index + 1));
    let request: Record<string, unknown> | undefined;
    await page.route("**/api/taste", async (route) => {
      request = route.request().postDataJSON();
      await route.fulfill({ json: { selected: places, warnings: [] } });
    });
    await page.goto("/explore");
    const recommendations = page.getByRole("region", {
      name: "Personal recommendations",
      exact: true,
    });
    await recommendations.getByRole("button", { name: "Find places", exact: true }).click();
    await expect(
      page.getByText("Showing 12 of 15 loaded places · Ranked by Qloo", { exact: true }),
    ).toBeVisible();
    expect(request).toMatchObject({
      destinationId: "lisbon",
      radiusMetres: 8000,
      take: 50,
      entityIds: [favorite.id],
    });
    expect(await stored(page)).toEqual(trip);
    await page.getByRole("button", { name: "Show more places", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "View lisbon discovery fixture 15", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const filters = page.getByRole("dialog", { name: "Filters", exact: true });
    await filters.getByRole("button", { name: "Cafés", exact: true }).click();
    await filters.getByRole("button", { name: "Show places", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "View lisbon discovery fixture 2", exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole("button", { name: "Save lisbon discovery fixture 7", exact: true })
      .click();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved:guest") ?? "[]"),
    );
    expect(saved[0]).toMatchObject({ place: places[6], destination: DESTINATIONS[0] });
    await page
      .getByRole("button", { name: "View lisbon discovery fixture 7", exact: true })
      .click();
    const venue = page.getByRole("dialog", { name: "lisbon discovery fixture 7", exact: true });
    await venue.getByRole("button", { name: "Add to trip", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add place to trip", exact: true });
    await add.getByLabel("Place visit start time", { exact: true }).fill("11:15");
    await add.getByRole("button", { name: "Add visit", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Adjust schedule", exact: true })).toBeVisible();
    const accepted = await stored(page);
    expect(accepted.places[0].taste).toEqual(places[6]!.taste);
    expect(accepted.stops[0]).toMatchObject({
      placeId: places[6]!.id,
      selection: places[6]!.taste,
      startTime: "11:15",
    });
    await page.reload();
    await expect(page.getByRole("dialog", { name: "Adjust schedule", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

test("Explore stops searches, rejects stale-city replies and retries without losing filters", async ({
  page,
}) => {
  const trip = draft();
  await seed(page, trip);
  const waiting: (() => void)[] = [];
  let attempts = 0;
  await page.route("**/api/taste", async (route) => {
    attempts++;
    const city = route.request().postDataJSON().destinationId;
    if (attempts <= 2) await new Promise<void>((resolve) => waiting.push(resolve));
    if (attempts === 3)
      await route.fulfill({
        status: 503,
        json: { error: { message: "Synthetic provider interruption" } },
      });
    else
      await route
        .fulfill({ json: { selected: [candidate(city, 7)], warnings: [] } })
        .catch(() => {});
  });
  await page.goto("/explore?type=restaurant");
  const recommendations = page.getByRole("region", {
    name: "Personal recommendations",
    exact: true,
  });
  await recommendations.getByRole("button", { name: "Find places", exact: true }).click();
  await expect.poll(() => waiting.length).toBe(1);
  await recommendations.getByRole("button", { name: "Stop search", exact: true }).click();
  waiting[0]!();
  await expect(recommendations).toContainText("Search stopped");
  await recommendations.getByRole("button", { name: "Find places", exact: true }).click();
  await expect.poll(() => waiting.length).toBe(2);
  await page.getByRole("button", { name: "Explore location: Lisbon", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Explore location", exact: true })
    .getByRole("button", { name: "Porto", exact: true })
    .click();
  waiting[1]!();
  await expect(
    page.getByRole("button", { name: "View lisbon discovery fixture 7", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Filters", exact: true })
    .getByRole("button", { name: "Cafés", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Filters", exact: true })
    .getByRole("button", { name: "Show places", exact: true })
    .click();
  await recommendations.getByRole("button", { name: "Find places", exact: true }).click();
  await expect(recommendations.getByRole("alert")).toContainText("Synthetic provider interruption");
  await recommendations.getByRole("button", { name: "Retry search", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "View porto discovery fixture 7", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Remove Cafés filter", exact: true }),
  ).toBeVisible();
  expect(await stored(page)).toEqual(trip);
});

test("a guest discovers and saves in a custom city without creating or replacing a trip", async ({
  page,
}) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true } } }),
  );
  await page.route("**/api/taste/search", (route) =>
    route.fulfill({ json: { results: [favorite] } }),
  );
  const destination = {
    id: "geonames-2988507",
    name: "Paris",
    country: "France",
    lat: 48.85,
    lng: 2.35,
    timeZone: "Europe/Paris",
  };
  await page.route("**/api/destinations", (route) =>
    route.fulfill({ json: { results: [destination] } }),
  );
  const place = { ...candidate(destination.id, 7), lat: destination.lat, lng: destination.lng };
  await page.route("**/api/taste", (route) =>
    route.fulfill({ json: { selected: [place], warnings: [] } }),
  );
  await page.goto("/explore");
  await page.getByRole("button", { name: "Explore location: Lisbon", exact: true }).click();
  const location = page.getByRole("dialog", { name: "Explore location", exact: true });
  await location.getByText("Search another destination", { exact: true }).click();
  await location.getByLabel("City or destination", { exact: true }).fill("Paris");
  await location.getByRole("button", { name: "Find city", exact: true }).click();
  await location.getByRole("button", { name: /Paris, France/ }).click();
  await page.getByRole("button", { name: "Choose favorites", exact: true }).click();
  const favorites = page.getByRole("dialog", { name: "Your favorites", exact: true });
  await favorites.getByLabel("Search favorites", { exact: true }).fill("fixture");
  await favorites.getByRole("button", { name: "Search", exact: true }).click();
  await favorites.getByRole("button", { name: `${favorite.name} · artist`, exact: true }).click();
  await favorites.getByRole("button", { name: "Use these favorites", exact: true }).click();
  await page
    .getByRole("region", { name: "Personal recommendations", exact: true })
    .getByRole("button", { name: "Find places", exact: true })
    .click();
  await page.getByRole("button", { name: `Save ${place.name}`, exact: true }).click();
  expect(await stored(page)).toBeNull();
  await page.goto("/saved");
  await page
    .getByRole("navigation", { name: "Saved views", exact: true })
    .getByRole("button", { name: /^Places/ })
    .click();
  await page.reload();
  await page
    .getByRole("navigation", { name: "Saved views", exact: true })
    .getByRole("button", { name: /^Places/ })
    .click();
  await page.getByRole("button", { name: `View ${place.name}`, exact: true }).click();
  await expect(page.getByRole("dialog", { name: place.name, exact: true })).toBeVisible();
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.reference.saved:guest") ?? "[]"),
  );
  expect(saved[0]).toEqual({ place, destination });
});

test("recommendation search bounds reject invalid radii and counts before provider access", async ({
  request,
}) => {
  for (const extra of [
    { radiusMetres: 499 },
    { radiusMetres: 50001 },
    { take: 0 },
    { take: 51 },
    { take: 1.5 },
  ]) {
    const response = await request.post("/api/taste", {
      headers: { Origin: E2E_ORIGIN },
      data: { entityIds: [favorite.id], destinationId: "lisbon", ...extra },
    });
    expect(response.status()).toBe(400);
  }
});

test("sign-out aborts private discovery and hides its late reply from the guest workspace", async ({
  page,
}) => {
  const owner = { id: "00000000-0000-4000-8000-000000000019", username: "discovery-owner" };
  let account: typeof owner | null = owner;
  await page.route("**/api/account", async (route) => {
    if (route.request().method() === "POST") account = null;
    await route.fulfill({ json: { account } });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true } } }),
  );
  const trip = draft();
  await page.addInitScript(
    ({ id, trip }) => localStorage.setItem(`tastip.trip.v1:${id}`, JSON.stringify(trip)),
    { id: owner.id, trip },
  );
  let finish: (() => void) | undefined;
  await page.route("**/api/taste", async (route) => {
    await new Promise<void>((resolve) => {
      finish = resolve;
    });
    await route
      .fulfill({ json: { selected: [candidate("lisbon", 19)], warnings: [] } })
      .catch(() => {});
  });
  await page.goto("/explore");
  await page
    .getByRole("region", { name: "Personal recommendations", exact: true })
    .getByRole("button", { name: "Find places", exact: true })
    .click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByRole("button", { name: "discovery-owner Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("button", { name: "Sign in to Tastip", exact: true })).toBeVisible();
  finish!();
  await page.goto("/explore");
  await expect(page.getByRole("button", { name: "Choose favorites", exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "View lisbon discovery fixture 19", exact: true }),
  ).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`tastip.trip.v1:${id}`) ?? "null"),
      owner.id,
    ),
  ).toEqual(trip);
});
