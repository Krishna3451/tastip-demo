import { expect, type Page, test } from "@playwright/test";
import {
  applyTripCommand,
  createTripFromPlaces,
  DEFAULT_BRIEF,
  type Place,
  type Trip,
} from "../../packages/domain/src";

const favorite = {
  id: "00000000-0000-4000-8000-000000000092",
  name: "Synthetic day favorite",
  type: "urn:entity:artist",
};
function fixture() {
  const empty = createTripFromPlaces(
    {
      ...DEFAULT_BRIEF,
      days: 4,
      tasteProfile: { seeds: [favorite], categories: [], dayStyle: "Art and cafés" },
    },
    [],
  );
  const result = applyTripCommand(empty, {
    id: "synthetic-day-route",
    baseVersion: empty.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: null,
          stays: [
            { id: "lisbon-stay", destinationId: "lisbon", days: 2 },
            { id: "porto-stay", destinationId: "porto", days: 2 },
          ],
          transfers: [
            {
              id: "synthetic-transfer",
              fromStayId: "lisbon-stay",
              toStayId: "porto-stay",
              mode: "undecided",
            },
          ],
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.trip;
}
function candidates(suffix = "current"): Place[] {
  return [9, 2].map((rank) => ({
    id: `synthetic-porto-${suffix}-${rank}`,
    destinationId: "porto",
    name: `Synthetic Porto ${suffix} place ${rank}`,
    description: "Synthetic Qloo boundary fixture, not a live recommendation.",
    category: "culture",
    source: "qloo",
    lat: 41.15,
    lng: -8.62,
    taste: { queryId: `synthetic-porto-${suffix}-query`, rank, score: 0.99 },
    practical: { hours: "unknown", cost: "unknown" },
  }));
}
async function setup(page: Page, initial = fixture(), brokenPreferences = false) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: true } } }),
  );
  await page.addInitScript(
    ({ trip, brokenPreferences }) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      if (brokenPreferences)
        localStorage.setItem("tastip.reference.settings:guest", "unreadable preferences fixture");
    },
    { trip: initial, brokenPreferences },
  );
  return initial;
}
async function openTray(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true })
    .click();
  const chat = page.getByRole("region", { name: "Planner chat", exact: true });
  await chat.getByRole("button", { name: "Places for Day 3", exact: true }).click();
  const tray = chat.getByRole("region", { name: "Suggestions for this day", exact: true });
  await expect(tray).toBeVisible();
  return { chat, tray };
}
function stored(page: Page): Promise<Trip> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}

for (const width of [375, 1440]) {
  test(`day suggestions stay outside the trip until reviewed Add and preserve Qloo evidence through Undo at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const previous = await setup(page);
    let calls = 0;
    await page.route("**/api/taste", (route) => {
      calls++;
      const request = route.request().postDataJSON();
      expect(request).toMatchObject({
        entityIds: [favorite.id],
        destinationId: "porto",
        radiusMetres: 8000,
      });
      return route.fulfill({
        json: {
          provider: "qloo",
          queryId: "synthetic-porto-current-query",
          selected: candidates(),
          warnings: [],
        },
      });
    });
    await page.goto("/home?day=day-3");
    const { chat, tray } = await openTray(page);
    await expect(tray.getByRole("heading", { name: "Day 3 · Porto", exact: true })).toBeVisible();
    const composer = chat.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await composer.fill("Keep my unsent chat question");
    expect(calls).toBe(0);
    await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
    const card = tray.getByRole("article").filter({ hasText: "Synthetic Porto current place 2" });
    await expect(card).toBeVisible();
    await expect(card).toContainText("Qloo · original rank 2");
    await card.getByText("Recommendation source", { exact: true }).click();
    await expect(card).toContainText("synthetic-porto-current-query");
    expect(await card.textContent()).not.toMatch(/99\s*%|affinity/i);
    expect(await stored(page)).toEqual(previous);
    await card
      .getByRole("button", {
        name: "Review Synthetic Porto current place 2 for Day 3",
        exact: true,
      })
      .click();
    const review = page.getByRole("dialog", { name: "Add place to trip", exact: true });
    await expect(review.getByLabel("Place visit day", { exact: true })).toHaveValue("day-3");
    await expect(
      review.getByLabel("Place visit day", { exact: true }).getByRole("option"),
    ).toHaveCount(1);
    expect(await stored(page)).toEqual(previous);
    await review.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      card.getByRole("button", {
        name: "Review Synthetic Porto current place 2 for Day 3",
        exact: true,
      }),
    ).toBeFocused();
    await card
      .getByRole("button", {
        name: "Review Synthetic Porto current place 2 for Day 3",
        exact: true,
      })
      .click();
    await review.getByLabel("Place visit start time", { exact: true }).fill("13:30");
    await review.getByLabel("Place visit duration", { exact: true }).fill("75");
    await review.getByRole("button", { name: "Add visit", exact: true }).click();
    await expect.poll(async () => (await stored(page)).version).toBe(previous.version + 1);
    const accepted = await stored(page);
    expect(accepted.route).toEqual(previous.route);
    expect(accepted.stops).toHaveLength(1);
    expect(accepted.stops[0]).toMatchObject({
      dayId: "day-3",
      startTime: "13:30",
      durationMinutes: 75,
      selection: { queryId: "synthetic-porto-current-query", rank: 2, score: 0.99 },
    });
    expect(accepted.places[0]?.destinationId).toBe("porto");
    expect(accepted.places[0]?.taste).toEqual(accepted.stops[0]?.selection);
    await page.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(composer).toHaveValue("Keep my unsent chat question");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect.poll(async () => (await stored(page)).stops.length).toBe(0);
    expect((await stored(page)).places).toEqual(previous.places);
    expect(calls).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("closing or changing the selected day rejects late suggestions and requires another explicit search", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const previous = await setup(page);
  const requests: { release: () => void; finished: Promise<void> }[] = [];
  await page.route("**/api/taste", async (route) => {
    let release = () => {};
    let finish = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const index = requests.length;
    requests.push({ release, finished });
    await gate;
    try {
      await route.fulfill({
        json: {
          provider: "qloo",
          queryId: `synthetic-porto-response${index}-query`,
          selected: candidates(`response${index}`),
          warnings: [],
        },
      });
    } catch {
      /* Cancelled browser requests can reject a late synthetic response. */
    } finally {
      finish();
    }
  });
  await page.goto("/home?day=day-3");
  const { chat, tray } = await openTray(page);
  await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await tray.getByRole("button", { name: "Stop search", exact: true }).click();
  await expect(tray).toContainText("Search stopped");
  await tray.getByRole("button", { name: "Retry suggestions", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  await chat.getByRole("button", { name: "Places for Day 3", exact: true }).click();
  requests[0]?.release();
  requests[1]?.release();
  await Promise.all(requests.map((request) => request.finished));
  await chat.getByRole("button", { name: "Places for Day 3", exact: true }).click();
  await expect(tray.getByRole("article")).toHaveCount(0);
  expect(requests).toHaveLength(2);
  await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
  await expect.poll(() => requests.length).toBe(3);
  const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
  await journey
    .getByRole("navigation", { name: "Choose another day", exact: true })
    .getByRole("button", { name: "Open Day 4 schedule in Porto", exact: true })
    .click();
  requests[2]?.release();
  await requests[2]?.finished;
  await expect(tray.getByRole("heading", { name: "Day 4 · Porto", exact: true })).toBeVisible();
  await expect(tray.getByRole("article")).toHaveCount(0);
  await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
  await expect.poll(() => requests.length).toBe(4);
  requests[3]?.release();
  await expect(tray.getByRole("article")).toHaveCount(2);
  await expect(tray).toContainText("Synthetic Porto response3 place 2");
  await expect(tray).not.toContainText("Synthetic Porto response2 place 2");
  expect(await stored(page)).toEqual(previous);
});

test("unreadable preferences pause day suggestions without requesting Qloo", async ({ page }) => {
  await setup(page, fixture(), true);
  let calls = 0;
  await page.route("**/api/taste", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/home?day=day-3");
  const { tray } = await openTray(page);
  await expect(
    tray.getByRole("button", { name: "Find places for this day", exact: true }),
  ).toBeDisabled();
  await expect(tray).toContainText("saved preferences could not be read");
  expect(calls).toBe(0);
});
