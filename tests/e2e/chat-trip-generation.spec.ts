import { expect, type Page, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF, type Place, type Trip } from "../../packages/domain/src";

const seed = {
  id: "00000000-0000-4000-8000-000000000026",
  name: "Trip planning fixture artist",
  type: "urn:entity:artist",
};
const request = "Lisbon and Porto for 4 days with 2 adults";
function oldTrip() {
  return createDemoTrip({
    ...DEFAULT_BRIEF,
    tasteProfile: { seeds: [seed], categories: [], dayStyle: "Art and cafés" },
  });
}
function places(city: string): Place[] {
  return [9, 1, 7, 3, 12, 5].map((rank) => ({
    id: `${city}-trip-place-${rank}`,
    destinationId: city,
    name: `${city} trip fixture ${rank}`,
    description: "Synthetic trip-generation contract fixture, not a real venue.",
    source: "qloo",
    category: "culture",
    lat: city === "porto" ? 41.15 : 38.72,
    lng: city === "porto" ? -8.62 : -9.13,
    taste: { queryId: `${city}-planning-query`, rank },
    practical: { hours: "unknown", cost: "unknown" },
  }));
}
async function setup(page: Page, previous = oldTrip()) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: true } } }),
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      json: { message: "Your reviewed trip is ready to discuss.", provider: "openai" },
    }),
  );
  await page.addInitScript(
    ({ previous, request }) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(previous));
      if (!localStorage.getItem("tastip.reference.chats:guest"))
        localStorage.setItem(
          "tastip.reference.chats:guest",
          JSON.stringify([
            {
              id: "planning-chat",
              title: "Planning fixture",
              updatedAt: 1,
              messages: [
                { id: "request", role: "user", text: request },
                { id: "reply", role: "assistant", text: "Let’s review the details." },
              ],
            },
          ]),
        );
    },
    { previous, request },
  );
  return previous;
}
async function enterReview(page: Page) {
  await page.goto("/chat/planning-chat");
  await page.getByRole("button", { name: "Build this trip", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
  await expect(
    details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
  ).toHaveValue(request);
  await details.getByRole("button", { name: "Review trip", exact: true }).click();
  return page.getByRole("dialog", { name: "Review your personal trip", exact: true });
}
async function stored(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}
for (const width of [375, 1440])
  test(`chat builds a reviewed two-city Qloo trip, preserves its predecessor and reopens it at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const previous = await setup(page);
    const seen: string[] = [];
    await page.route("**/api/taste", async (route) => {
      const body = route.request().postDataJSON();
      seen.push(body.destinationId);
      expect(body.take).toBe(20);
      await route.fulfill({ json: { selected: places(body.destinationId), warnings: [] } });
    });
    const review = await enterReview(page);
    await review.getByLabel("Trip pace", { exact: true }).selectOption("slow");
    expect(await stored(page)).toEqual(previous);
    await review.getByRole("button", { name: "Find my places", exact: true }).click();
    await expect(
      review.getByRole("region", { name: "Proposed itinerary", exact: true }),
    ).toBeVisible();
    expect(await stored(page)).toEqual(previous);
    expect(seen).toEqual(["lisbon", "porto"]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await review.getByRole("button", { name: "Create this trip", exact: true }).click();
    await expect(review).not.toBeVisible();
    expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
    await expect(page.getByRole("link", { name: "Trip", exact: true })).toBeVisible();
    const accepted = await stored(page);
    expect(accepted.id).not.toBe(previous.id);
    expect(accepted.days).toHaveLength(4);
    expect(accepted.brief.partySize).toBe(2);
    expect(accepted.brief.pace).toBe("slow");
    expect(accepted.stops).toHaveLength(8);
    for (const stop of accepted.stops) {
      const place = accepted.places.find((item: Place) => item.id === stop.placeId);
      expect(stop.selection).toEqual(place.taste);
    }
    expect(
      accepted.places
        .filter((item: Place) => item.destinationId === "porto")
        .every((item: Place) => item.taste?.queryId === "porto-planning-query"),
    ).toBe(true);
    const archive = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.library.v1") ?? "[]"),
    );
    expect(archive.find((item: Trip) => item.id === previous.id)).toEqual(previous);
    const chats = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]"),
    );
    expect(chats.find((item: { id: string }) => item.id === "planning-chat").tripId).toBe(
      accepted.id,
    );
    await page.reload();
    await expect(page.getByRole("link", { name: "Trip", exact: true })).toHaveAttribute(
      "href",
      `/trip/${accepted.id}`,
    );
    await page.getByRole("link", { name: "Trip", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Lisbon → Porto", exact: true })).toBeVisible();
  });

test("stopped planning keeps completed city results for retry and rejects a late city reply", async ({
  page,
}) => {
  const previous = await setup(page);
  const seen: string[] = [];
  let finish: (() => void) | undefined;
  await page.route("**/api/taste", async (route) => {
    const city = route.request().postDataJSON().destinationId;
    seen.push(city);
    if (city === "porto" && seen.length === 2)
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
    await route.fulfill({ json: { selected: places(city), warnings: [] } }).catch(() => {});
  });
  const review = await enterReview(page);
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await review.getByRole("button", { name: "Stop planning", exact: true }).click();
  finish!();
  await expect(review.getByRole("button", { name: "Create this trip", exact: true })).toHaveCount(
    0,
  );
  expect(await stored(page)).toEqual(previous);
  await review.getByRole("button", { name: "Retry planning", exact: true }).click();
  await expect(review.getByRole("button", { name: "Create this trip", exact: true })).toBeVisible();
  expect(seen).toEqual(["lisbon", "porto", "porto"]);
  expect(await stored(page)).toEqual(previous);
});

test("a failed city never accepts a partial plan, and Back preserves trip details", async ({
  page,
}) => {
  const previous = await setup(page);
  await page.route("**/api/taste", async (route) => {
    const city = route.request().postDataJSON().destinationId;
    await route.fulfill(
      city === "porto"
        ? { status: 503, json: { error: { message: "Synthetic Porto interruption" } } }
        : { json: { selected: places(city), warnings: [] } },
    );
  });
  const review = await enterReview(page);
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("Synthetic Porto interruption");
  await expect(review.getByRole("button", { name: "Create this trip", exact: true })).toHaveCount(
    0,
  );
  expect(await stored(page)).toEqual(previous);
  await review.getByRole("button", { name: "Back to trip details", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
  await expect(
    details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
  ).toHaveValue(request);
});

test("archive failure preserves the accepted draft and keeps the same preview for retry", async ({
  page,
}) => {
  const previous = await setup(page);
  await page.addInitScript(() =>
    localStorage.setItem("tastip.library.v1", '"unreadable fixture archive"'),
  );
  await page.route("**/api/taste", (route) =>
    route.fulfill({
      json: { selected: places(route.request().postDataJSON().destinationId), warnings: [] },
    }),
  );
  const review = await enterReview(page);
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await review.getByRole("button", { name: "Create this trip", exact: true }).click();
  await expect(review.getByRole("alert")).toContainText("not accepted");
  expect(await stored(page)).toEqual(previous);
  expect(await page.evaluate(() => localStorage.getItem("tastip.library.v1"))).toBe(
    '"unreadable fixture archive"',
  );
  await page.evaluate(() => localStorage.setItem("tastip.library.v1", "[]"));
  await review.getByRole("button", { name: "Create this trip", exact: true }).click();
  await expect(review).not.toBeVisible();
  expect((await stored(page)).id).not.toBe(previous.id);
});

test("Discover can start the same reviewed planning flow and create an associated chat", async ({
  page,
}) => {
  await setup(page);
  await page.route("**/api/taste", (route) =>
    route.fulfill({
      json: { selected: places(route.request().postDataJSON().destinationId), warnings: [] },
    }),
  );
  await page.goto("/discover");
  await page.getByRole("button", { name: "Build my trip", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
  await details
    .getByLabel("What should I keep in mind for this trip?", { exact: true })
    .fill("Lisbon for 2 days with 1 adult");
  await details.getByRole("button", { name: "Plan with my favorites", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review your personal trip", exact: true });
  await review.getByRole("button", { name: "Find my places", exact: true }).click();
  await review.getByRole("button", { name: "Create this trip", exact: true }).click();
  await expect(page).toHaveURL(/\/chat\/[a-f0-9-]+$/);
  await expect(page.getByRole("link", { name: "Trip", exact: true })).toBeVisible();
  await expect(
    page.locator(".chat-message").filter({ hasText: "Your reviewed trip is ready to discuss." }),
  ).toBeVisible();
});

test("multi-turn chat retains cities and applies later traveler and duration clarifications", async ({
  page,
}) => {
  const previous = await setup(page);
  await page.addInitScript(() =>
    localStorage.setItem(
      "tastip.reference.chats:guest",
      JSON.stringify([
        {
          id: "planning-chat",
          title: "Multi-turn fixture",
          updatedAt: 1,
          messages: [
            { id: "request", role: "user", text: "Lisbon and Porto for 4 days with 1 adult" },
            {
              id: "reply",
              role: "assistant",
              text: "Unconfirmed assistant suggestion: Tokyo and 20 travelers.",
            },
            { id: "party", role: "user", text: "Actually 2 adults and 1 child" },
            { id: "duration", role: "user", text: "Make it 6 days" },
            { id: "pace", role: "user", text: "Slow mornings, please" },
          ],
        },
      ]),
    ),
  );
  await page.goto("/chat/planning-chat");
  await page.getByRole("button", { name: "Build this trip", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
  await expect(
    details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
  ).toHaveValue(/Lisbon/);
  await expect(
    details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
  ).not.toHaveValue(/Tokyo/);
  await details.getByRole("button", { name: "Review trip", exact: true }).click();
  const review = page.getByRole("dialog", { name: "Review your personal trip", exact: true });
  await expect(review.getByRole("heading", { name: "Lisbon → Porto", exact: true })).toBeVisible();
  await expect(review).toContainText("6 days · 3 travelers");
  expect(await stored(page)).toEqual(previous);
});

test("unavailable Qloo can create an explicit blank draft without requesting recommendations", async ({
  page,
}) => {
  const previous = await setup(page);
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: false, openai: true } } }),
  );
  let tasteCalls = 0;
  await page.route("**/api/taste", (route) => {
    tasteCalls++;
    return route.fulfill({ status: 503, json: { error: { message: "Unavailable fixture" } } });
  });
  const review = await enterReview(page);
  await expect(review.getByRole("button", { name: "Find my places", exact: true })).toBeDisabled();
  await review.getByRole("button", { name: "Create blank draft", exact: true }).click();
  await expect(review).not.toBeVisible();
  await expect(page.getByRole("link", { name: "Trip", exact: true })).toBeVisible();
  const blank = await stored(page);
  expect(blank.id).not.toBe(previous.id);
  expect(blank.stops).toEqual([]);
  expect(blank.days).toHaveLength(4);
  expect(tasteCalls).toBe(0);
});
