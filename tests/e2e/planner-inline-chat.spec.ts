import { expect, type Page, test } from "@playwright/test";
import type { Conversation } from "../../apps/web/src/features/planner/lib/conversations";
import { createDemoTrip, DEFAULT_BRIEF, type Place, type Trip } from "../../packages/domain/src";

const favorite = {
  id: "00000000-0000-4000-8000-000000000065",
  name: "Inline planning fixture artist",
  type: "urn:entity:artist",
};
const planningRequest = "Plan a trip to Lisbon and Porto for 4 days with 2 adults";

function previousTrip() {
  return createDemoTrip({
    ...DEFAULT_BRIEF,
    tasteProfile: { seeds: [favorite], categories: [], dayStyle: "Art and cafés" },
  });
}
function candidates(city: string): Place[] {
  return [9, 1, 7, 3, 12, 5].map((rank) => ({
    id: `${city}-inline-fixture-${rank}`,
    destinationId: city,
    name: `${city} inline fixture ${rank}`,
    description: "Synthetic inline-planning fixture, not a real venue.",
    source: "qloo",
    category: "culture",
    lat: city === "porto" ? 41.15 : 38.72,
    lng: city === "porto" ? -8.62 : -9.13,
    taste: { queryId: `${city}-inline-query`, rank },
    practical: { hours: "unknown", cost: "unknown" },
  }));
}
async function seed(page: Page, trip: Trip) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo: true } } }),
  );
  await page.addInitScript((trip) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
  }, trip);
}
function headerChat(page: Page) {
  return page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true });
}
async function openInline(page: Page) {
  await headerChat(page).click();
  const panel = page.getByRole("region", { name: "Planner chat", exact: true });
  await expect(panel).toBeVisible();
  return panel.getByRole("region", { name: "Travel conversation", exact: true });
}
async function storedTrip(page: Page): Promise<Trip> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}
async function storedChats(page: Page, scope = "guest"): Promise<Conversation[]> {
  return page.evaluate(
    (scope) => JSON.parse(localStorage.getItem(`tastip.reference.chats:${scope}`) ?? "[]"),
    scope,
  );
}

for (const width of [375, 1440]) {
  test(`primary Chat stays in place, retains its composer and applies one reviewed canonical edit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const trip = previousTrip();
    const stop = trip.stops.find((item) => item.dayId === "day-2")!;
    await seed(page, trip);
    let calls = 0;
    await page.route("**/api/chat", async (route) => {
      calls++;
      expect(route.request().postDataJSON().trip).toMatchObject({
        id: trip.id,
        version: trip.version,
      });
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: [
          { type: "text", text: "Review keeping this visit." },
          {
            type: "complete",
            reply: {
              provider: "openai",
              message: "Review keeping this visit.",
              proposal: {
                id: `inline-pin-${width}`,
                tripId: trip.id,
                baseVersion: trip.version,
                summary: "Keep the selected day-two visit.",
                operations: [{ type: "pin-stop", stopId: stop.id, pinned: true }],
              },
            },
          },
        ]
          .map((frame) => `${JSON.stringify(frame)}\n`)
          .join(""),
      });
    });
    await page.goto("/?day=day-2");
    const originalUrl = page.url();
    let conversation = await openInline(page);
    if (width === 375) {
      const chatBounds = await page.getByRole("region", { name: "Planner chat" }).boundingBox();
      const planBounds = await page.getByRole("region", { name: "Your trip plan" }).boundingBox();
      expect(chatBounds).not.toBeNull();
      expect(planBounds).not.toBeNull();
      expect(chatBounds!.y + chatBounds!.height).toBeLessThanOrEqual(planBounds!.y);
    }
    expect(page.url()).toBe(originalUrl);
    const composer = conversation.getByLabel("Message your travel companion", { exact: true });
    await composer.fill("Keep my selected day-two visit.");
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(conversation.getByText("Review trip change", { exact: true })).toBeVisible();
    await expect.poll(async () => (await storedChats(page))[0]?.messages.length).toBe(2);
    const chat = (await storedChats(page))[0]!;
    expect(chat.tripId).toBe(trip.id);
    expect(chat.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(await storedTrip(page)).toEqual(trip);
    await composer.fill("Keep this unsent next question.");
    await page.getByRole("button", { name: "Close planner chat", exact: true }).click();
    await expect(headerChat(page)).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("region", { name: "Planner chat", exact: true })).toBeHidden();
    conversation = await openInline(page);
    await expect(composer).toHaveValue("Keep this unsent next question.");
    expect((await storedChats(page))[0]?.id).toBe(chat.id);
    expect(calls).toBe(1);
    await conversation.getByRole("button", { name: "Apply change", exact: true }).click();
    await expect.poll(async () => (await storedTrip(page)).version).toBe(trip.version + 1);
    expect((await storedTrip(page)).stops.find((item) => item.id === stop.id)?.pinned).toBe(true);
    await expect(composer).toHaveValue("Keep this unsent next question.");
    expect(page.url()).toBe(originalUrl);
    await page.reload();
    conversation = await openInline(page);
    await expect(
      conversation.getByText(`Applied · draft v${trip.version + 1}`, { exact: true }),
    ).toBeVisible();
    await expect(conversation.locator(".chat-message.user-message")).toHaveCount(1);
    await expect(conversation.locator(".chat-message.assistant-message")).toHaveCount(1);
    expect((await storedChats(page))[0]?.id).toBe(chat.id);
    expect(calls).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`inline chat reviews a two-city Qloo trip, archives its predecessor and keeps the same conversation at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const previous = previousTrip();
    await seed(page, previous);
    let chatCalls = 0;
    await page.route("**/api/chat", (route) => {
      chatCalls++;
      return route.fulfill({
        json: { provider: "openai", message: "Let’s review the cities and your favorites." },
      });
    });
    const cities: string[] = [];
    await page.route("**/api/taste", async (route) => {
      const body = route.request().postDataJSON();
      cities.push(body.destinationId);
      expect(body.entityIds).toEqual([favorite.id]);
      expect(body.take).toBe(20);
      await route.fulfill({ json: { selected: candidates(body.destinationId), warnings: [] } });
    });
    await page.goto("/");
    let conversation = await openInline(page);
    await conversation
      .getByLabel("Message your travel companion", { exact: true })
      .fill(planningRequest);
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(
      conversation
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Let’s review the cities and your favorites." }),
    ).toBeVisible();
    const chatId = (await storedChats(page))[0]!.id;
    await conversation.getByRole("button", { name: "Build this trip", exact: true }).click();
    const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
    await expect(
      details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
    ).toHaveValue(planningRequest);
    await details.getByRole("button", { name: "Review trip", exact: true }).click();
    const review = page.getByRole("dialog", { name: "Review your personal trip", exact: true });
    await review.getByLabel("Trip pace", { exact: true }).selectOption("slow");
    expect(await storedTrip(page)).toEqual(previous);
    await review.getByRole("button", { name: "Find my places", exact: true }).click();
    await expect(
      review.getByRole("region", { name: "Proposed itinerary", exact: true }),
    ).toBeVisible();
    expect(cities).toEqual(["lisbon", "porto"]);
    expect(await storedTrip(page)).toEqual(previous);
    await review.getByRole("button", { name: "Create this trip", exact: true }).click();
    await expect(review).not.toBeVisible();
    await expect(
      page.getByRole("region", { name: "Your floating day journey", exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
    const accepted = await storedTrip(page);
    expect(accepted.id).not.toBe(previous.id);
    expect(accepted.days).toHaveLength(4);
    expect(accepted.brief.partySize).toBe(2);
    expect(accepted.brief.pace).toBe("slow");
    expect(accepted.stops).toHaveLength(8);
    for (const stop of accepted.stops) {
      expect(stop.selection).toEqual(
        accepted.places.find((place) => place.id === stop.placeId)?.taste,
      );
    }
    const archive: Trip[] = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.library.v1") ?? "[]"),
    );
    expect(archive.find((trip) => trip.id === previous.id)).toEqual(previous);
    const chats = await storedChats(page);
    expect(chats).toHaveLength(1);
    expect(chats[0]?.id).toBe(chatId);
    expect(chats[0]?.tripId).toBe(accepted.id);
    expect(chats[0]?.messages).toHaveLength(2);
    conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
    await expect(
      conversation
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Let’s review the cities and your favorites." }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Full conversation", exact: true }),
    ).toHaveAttribute(
      "href",
      new RegExp(`^/chat/${chatId}\\?trip=${accepted.id}&return=planner&day=day-1$`),
    );
    await page.reload();
    conversation = await openInline(page);
    await expect(conversation.locator(".chat-message.user-message")).toHaveCount(1);
    expect((await storedChats(page))[0]?.tripId).toBe(accepted.id);
    expect((await storedTrip(page)).id).toBe(accepted.id);
    expect(chatCalls).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("inline chat honors memory-off without sharing the saved personal profile while keeping explicit trip context", async ({
  page,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  await seed(page, trip);
  const profile = {
    firstName: "PrivateMemoryFixture",
    lastName: "",
    city: null,
    tripIdea: "",
    loyalty: [],
    destinations: [],
    visited: [],
    companions: [],
    budget: [],
    splurges: [],
    lodging: [],
    restaurants: [],
    dietary: [],
    weekends: [],
    notes: "Synthetic private profile note 8254",
  };
  await page.addInitScript((profile) => {
    localStorage.setItem("tastip.reference.profile:guest", JSON.stringify(profile));
  }, profile);
  const bodies: {
    trip?: { id: string };
    preferences: { memory: boolean };
    travelPreferences?: string;
  }[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await route.fulfill({ json: { provider: "openai", message: "Synthetic preference reply." } });
  });
  await page.goto("/");
  let conversation = await openInline(page);
  await conversation
    .getByLabel("Message your travel companion", { exact: true })
    .fill("Help me think about my trip.");
  await conversation.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(1);
  expect(bodies[0]?.travelPreferences).toContain(profile.notes);
  await expect(conversation.getByRole("button", { name: "Stop reply", exact: true })).toHaveCount(
    0,
  );
  await page.evaluate(() =>
    localStorage.setItem(
      "tastip.reference.settings:guest",
      JSON.stringify({ assistant: { voice: "marin", style: "neutral", memory: false } }),
    ),
  );
  await page.reload();
  conversation = await openInline(page);
  await conversation
    .getByLabel("Message your travel companion", { exact: true })
    .fill("Continue with this explicit itinerary only.");
  await conversation.getByRole("button", { name: "Send message", exact: true }).click();
  await expect.poll(() => bodies.length).toBe(2);
  expect(bodies[1]?.preferences.memory).toBe(false);
  expect(bodies[1]?.travelPreferences).toBeUndefined();
  expect(bodies[1]?.trip?.id).toBe(trip.id);
  expect(JSON.stringify(bodies[1])).not.toContain(profile.firstName);
  expect(JSON.stringify(bodies[1])).not.toContain(profile.notes);
});

test("an account switch closes inline chat and rejects the previous owner's late reply", async ({
  page,
}) => {
  const alice = { id: "00000000-0000-4000-8000-000000000071", username: "inline-fixture-alice" };
  const bob = { id: "00000000-0000-4000-8000-000000000072", username: "inline-fixture-bob" };
  let account = alice;
  await page.route("**/api/account", (route) => route.fulfill({ json: { account } }));
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true } } }),
  );
  const aliceTrip = { ...createDemoTrip(DEFAULT_BRIEF), title: "Alice private trip fixture" };
  const bobTrip = { ...createDemoTrip(DEFAULT_BRIEF), title: "Bob private trip fixture" };
  await page.addInitScript(
    ({ alice, bob, aliceTrip, bobTrip }) => {
      localStorage.setItem(`tastip.trip.v1:${alice.id}`, JSON.stringify(aliceTrip));
      localStorage.setItem(`tastip.trip.v1:${bob.id}`, JSON.stringify(bobTrip));
    },
    { alice, bob, aliceTrip, bobTrip },
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  await page.route("**/api/chat", async (route) => {
    calls++;
    await gate;
    try {
      await route.fulfill({
        json: { provider: "openai", message: "Private Alice late output fixture." },
      });
    } catch {
      // An aborted request is allowed to reject completion.
    } finally {
      finish();
    }
  });
  try {
    await page.goto("/");
    const conversation = await openInline(page);
    await conversation
      .getByLabel("Message your travel companion", { exact: true })
      .fill("Private Alice message fixture.");
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    await expect.poll(async () => (await storedChats(page, alice.id))[0]?.messages.length).toBe(1);
    account = bob;
    await page.evaluate(() =>
      window.dispatchEvent(new StorageEvent("storage", { key: "tastip.session.change.v1" })),
    );
    await expect(
      page.getByRole("button", { name: `Account ${bob.username}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(bobTrip.title);
    await expect(headerChat(page)).toHaveAttribute("aria-expanded", "false");
    release();
    await finished;
    const bobConversation = await openInline(page);
    await expect(bobConversation.locator(".chat-message")).toHaveCount(0);
    expect(JSON.stringify(await storedChats(page, bob.id))).not.toContain("Private Alice");
    expect(JSON.stringify(await storedChats(page, alice.id))).toContain(
      "Private Alice message fixture.",
    );
    expect(JSON.stringify(await storedChats(page, alice.id))).not.toContain(
      "Private Alice late output fixture.",
    );
    expect(calls).toBe(1);
  } finally {
    release();
  }
});

test("an unanswered inline request survives reload and retries explicitly without another user message", async ({
  page,
}) => {
  const trip = previousTrip();
  await seed(page, trip);
  const bodies: { message: string; history: unknown[] }[] = [];
  await page.route("**/api/chat", (route) => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill(
      bodies.length === 1
        ? { status: 503, json: { error: { message: "Synthetic inline interruption." } } }
        : { json: { provider: "openai", message: "The explicit inline retry is complete." } },
    );
  });
  await page.goto("/");
  let conversation = await openInline(page);
  await conversation
    .getByLabel("Message your travel companion", { exact: true })
    .fill("Help me make room for a quiet afternoon.");
  await conversation.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(conversation.getByRole("alert")).toContainText("Synthetic inline interruption.");
  const chatId = (await storedChats(page))[0]!.id;
  await page.reload();
  conversation = await openInline(page);
  await expect(
    conversation.getByRole("button", { name: "Retry reply", exact: true }),
  ).toBeVisible();
  expect(bodies).toHaveLength(1);
  await conversation
    .getByLabel("Message your travel companion", { exact: true })
    .fill("Keep my separate unsent follow-up.");
  await conversation.getByRole("button", { name: "Retry reply", exact: true }).click();
  await expect(
    conversation
      .locator(".chat-message.assistant-message")
      .filter({ hasText: "The explicit inline retry is complete." }),
  ).toBeVisible();
  await expect(
    conversation.getByLabel("Message your travel companion", { exact: true }),
  ).toHaveValue("Keep my separate unsent follow-up.");
  await expect(conversation.locator(".chat-message.user-message")).toHaveCount(1);
  expect(bodies).toHaveLength(2);
  expect(bodies[1]?.message).toBe(bodies[0]?.message);
  expect(bodies[1]?.history).toEqual([]);
  expect((await storedChats(page))[0]?.id).toBe(chatId);
  expect(await storedTrip(page)).toEqual(trip);
});
