import { expect, type Page, test } from "@playwright/test";
import type { Conversation } from "../../apps/web/src/features/planner/lib/conversations";
import { createDemoTrip, DEFAULT_BRIEF, type Place, type Trip } from "../../packages/domain/src";

const favorite = {
  id: "00000000-0000-4000-8000-000000000091",
  name: "Synthetic guidance favorite",
  type: "urn:entity:artist",
};
const planningPrompt = "Plan a trip to Lisbon and Porto for 4 days with 2 adults";
function previousTrip() {
  return createDemoTrip({
    ...DEFAULT_BRIEF,
    tasteProfile: { seeds: [favorite], dayStyle: "Art and cafés", categories: [] },
  });
}
async function setup(page: Page, trip?: Trip, chat?: Conversation, qloo = true) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo } } }),
  );
  await page.addInitScript(
    ({ trip, chat }) => {
      if (trip && !localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      if (chat && !localStorage.getItem("tastip.reference.chats:guest"))
        localStorage.setItem("tastip.reference.chats:guest", JSON.stringify([chat]));
    },
    { trip, chat },
  );
}
function headerChat(page: Page) {
  return page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true });
}
async function openChat(page: Page) {
  await headerChat(page).click();
  const panel = page.getByRole("region", { name: "Planner chat", exact: true });
  await expect(panel).toBeVisible();
  return panel;
}
function storedTrip(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}
function candidates(city: string): Place[] {
  return [4, 1, 7].map((rank) => ({
    id: `synthetic-${city}-guidance-${rank}`,
    destinationId: city,
    name: `Synthetic ${city} guidance candidate ${rank}`,
    description: "Synthetic provider boundary fixture, not a live recommendation.",
    category: "culture",
    source: "qloo",
    lat: city === "porto" ? 41.15 : 38.72,
    lng: city === "porto" ? -8.62 : -9.13,
    taste: { queryId: `synthetic-${city}-guidance-query`, rank },
    practical: { hours: "unknown", cost: "unknown" },
  }));
}

for (const width of [375, 1440]) {
  test(`fresh chat starters fill an editable composer without making a request at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await setup(page);
    let calls = 0;
    await page.route("**/api/chat", (route) => {
      calls++;
      expect(route.request().postDataJSON().message).toBe(planningPrompt);
      return route.fulfill({ json: { provider: "openai", message: "Synthetic guidance reply" } });
    });
    await page.goto("/");
    const chat = await openChat(page);
    await chat
      .getByRole("region", { name: "Conversation starters", exact: true })
      .getByRole("button", { name: "Plan a long weekend", exact: true })
      .click();
    const composer = chat.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await expect(composer).toBeFocused();
    await expect(composer).toHaveValue(/3-day trip/);
    expect(calls).toBe(0);
    expect(await storedTrip(page)).toBeNull();
    await composer.fill(planningPrompt);
    await chat.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      chat
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Synthetic guidance reply" }),
    ).toBeVisible();
    expect(calls).toBe(1);
    await chat.getByRole("button", { name: "Build this trip", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
    await expect(details).toContainText("Start with cities, dates and travelers.");
    await expect(
      details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
    ).toHaveValue(planningPrompt);
    expect(await storedTrip(page)).toBeNull();
    await details.getByRole("button", { name: "Close", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`an itinerary starter requires an explicit send before requesting a reviewed edit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const previous = previousTrip();
    const first = previous.stops[0];
    const place = previous.places.find((item) => item.id === first?.placeId);
    if (!first || !place) throw new Error("The guidance fixture needs a first visit.");
    await setup(page, previous);
    let calls = 0;
    await page.route("**/api/chat", (route) => {
      calls++;
      expect(route.request().postDataJSON().message).toBe(`Pin ${place.name}`);
      return route.fulfill({
        json: {
          provider: "openai",
          message: "Synthetic reviewed pin proposal",
          proposal: {
            id: `guidance-pin-${width}`,
            tripId: previous.id,
            baseVersion: previous.version,
            summary: "Keep the first visit",
            operations: [{ type: "pin-stop", stopId: first.id, pinned: true }],
          },
        },
      });
    });
    await page.goto("/home?day=day-1");
    const chat = await openChat(page);
    await chat.getByRole("button", { name: "Keep my first place", exact: true }).click();
    const composer = chat.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await expect(composer).toHaveValue(`Pin ${place.name}`);
    await expect(composer).toBeFocused();
    expect(calls).toBe(0);
    expect(await storedTrip(page)).toEqual(previous);
    await chat.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(chat.getByText("Review trip change", { exact: true })).toBeVisible();
    expect(calls).toBe(1);
    expect(await storedTrip(page)).toEqual(previous);
  });

  test(`review progress counts only received city responses and keeps acceptance separate at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const previous = previousTrip();
    await setup(page, previous, {
      id: "synthetic-guidance-chat",
      title: "Synthetic guidance plan",
      tripId: previous.id,
      updatedAt: 1,
      messages: [{ id: "guidance-request", role: "user", text: planningPrompt }],
    });
    const requests: { city: string; release: () => void; finished: Promise<void> }[] = [];
    await page.route("**/api/taste", async (route) => {
      const body = route.request().postDataJSON();
      expect(body.entityIds).toEqual([favorite.id]);
      let release = () => {};
      let finish = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const finished = new Promise<void>((resolve) => {
        finish = resolve;
      });
      requests.push({ city: body.destinationId, release, finished });
      await gate;
      try {
        await route.fulfill({ json: { selected: candidates(body.destinationId), warnings: [] } });
      } catch {
        // A stopped request may no longer accept its delayed synthetic response.
      } finally {
        finish();
      }
    });
    await page.goto("/home?day=day-1");
    const chat = await openChat(page);
    await chat.getByRole("button", { name: "Build this trip", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
    await details.getByRole("button", { name: "Review trip", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review your personal trip", exact: true });
    const steps = review.getByRole("region", { name: "Planning steps", exact: true });
    await expect(steps).toContainText("4 days reviewed");
    await expect(steps).toContainText("1 confirmed");
    await expect(steps).toContainText("Not loaded yet");
    expect(requests).toHaveLength(0);
    await review.getByRole("button", { name: "Find my places", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await expect(steps).toContainText("Requesting the first city");
    await expect(steps).not.toContainText("Preview ready");
    requests[0]?.release();
    await expect.poll(() => requests.length).toBe(2);
    await expect(steps).toContainText("1 of 2 city responses received");
    const cities = review.getByRole("list", { name: "City recommendation progress", exact: true });
    await expect(cities.getByRole("listitem").filter({ hasText: "Lisbon" })).toContainText(
      "3 Qloo candidates received",
    );
    await expect(cities.getByRole("listitem").filter({ hasText: "Porto" })).toContainText(
      "Requesting recommendations",
    );
    expect(await storedTrip(page)).toEqual(previous);
    await review.getByRole("button", { name: "Stop planning", exact: true }).click();
    requests[1]?.release();
    await requests[1]?.finished;
    await expect(steps).toContainText("1 of 2 city responses received");
    await expect(cities.getByRole("listitem").filter({ hasText: "Porto" })).toContainText(
      "Not loaded yet",
    );
    await expect(
      review.getByRole("region", { name: "Proposed itinerary", exact: true }),
    ).toHaveCount(0);
    await review.getByRole("button", { name: "Retry planning", exact: true }).click();
    await expect.poll(() => requests.length).toBe(3);
    expect(requests.map((request) => request.city)).toEqual(["lisbon", "porto", "porto"]);
    requests[2]?.release();
    await expect(
      review.getByRole("region", { name: "Proposed itinerary", exact: true }),
    ).toBeVisible();
    await expect(steps).toContainText("2 of 2 city responses received");
    await expect(steps.getByRole("listitem").filter({ hasText: "Your decision" })).toHaveAttribute(
      "aria-current",
      "step",
    );
    await expect(steps).toContainText("Preview ready · not saved");
    expect(await storedTrip(page)).toEqual(previous);
    await review.getByRole("button", { name: "Create this trip", exact: true }).click();
    await expect(review).toBeHidden();
    const accepted = await storedTrip(page);
    expect(accepted.id).not.toBe(previous.id);
    expect(accepted.days).toHaveLength(4);
    for (const stop of accepted.stops)
      expect(stop.selection).toEqual(
        accepted.places.find((place: Place) => place.id === stop.placeId)?.taste,
      );
    await expect(
      page.getByRole("region", { name: "Your floating day journey", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("new conversation keeps the external chat trigger for close and Escape focus", async ({
  page,
}) => {
  await setup(page);
  let calls = 0;
  await page.route("**/api/chat", (route) => {
    calls++;
    return route.abort();
  });
  await page.goto("/");
  const chat = await openChat(page);
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  await expect(
    chat.getByRole("textbox", { name: "Message your travel companion", exact: true }),
  ).toBeFocused();
  await chat.getByRole("button", { name: "Close planner chat", exact: true }).click();
  await expect(headerChat(page)).toBeFocused();
  await headerChat(page).click();
  await chat.getByRole("button", { name: "New conversation", exact: true }).click();
  const composer = chat.getByRole("textbox", {
    name: "Message your travel companion",
    exact: true,
  });
  await expect(composer).toBeFocused();
  await composer.press("Escape");
  await expect(headerChat(page)).toBeFocused();
  expect(calls).toBe(0);
  expect(await storedTrip(page)).toBeNull();
});
