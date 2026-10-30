import { expect, type Page, type Request, test } from "@playwright/test";
import {
  createTripFromPlaces,
  DEFAULT_BRIEF,
  type Place,
  type Trip,
} from "../../packages/domain/src";

const alice = { id: "00000000-0000-4000-8000-000000000081", username: "hosted-fixture-alice" };
const bob = { id: "00000000-0000-4000-8000-000000000082", username: "hosted-fixture-bob" };
const favorites = {
  [alice.id]: {
    id: "00000000-0000-4000-8000-000000000083",
    name: "Synthetic Alice favorite",
    type: "urn:entity:artist",
  },
  [bob.id]: {
    id: "00000000-0000-4000-8000-000000000084",
    name: "Synthetic Bob favorite",
    type: "urn:entity:artist",
  },
};
const profile = (owner: string) => ({
  firstName: owner === alice.id ? "PrivateAliceFixture" : "PrivateBobFixture",
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
  notes: `Synthetic private profile owned by ${owner}.`,
});
function trip(owner: string, destinationId: string): Trip {
  return {
    ...createTripFromPlaces(
      {
        ...DEFAULT_BRIEF,
        destinationId,
        days: 2,
        tasteProfile: { seeds: [favorites[owner]!], categories: [], dayStyle: "Culture and cafés" },
      },
      [],
    ),
    title: owner === alice.id ? "Alice owned hosted fixture" : "Bob owned hosted fixture",
  };
}
type Body = {
  trip?: { id: string };
  message?: string;
  preferences?: { memory: boolean };
  travelPreferences?: string;
  entityIds?: string[];
  destinationId?: string;
};
type Call = { path: string; owner: string | undefined; body: Body | undefined };
function capture(request: Request): Call {
  return {
    path: new URL(request.url()).pathname,
    owner: request.headers()["x-tastip-account"],
    body: request.method() === "POST" ? (request.postDataJSON() as Body) : undefined,
  };
}
function candidate(owner: string): Place {
  const city = owner === bob.id ? "porto" : "lisbon";
  return {
    id: `synthetic-hosted-${owner}`,
    destinationId: city,
    name: `Synthetic ${city} owned candidate`,
    description: "Synthetic browser identity fixture, not a real venue.",
    source: "qloo",
    category: "culture",
    lat: city === "porto" ? 41.15 : 38.72,
    lng: city === "porto" ? -8.62 : -9.13,
    taste: { queryId: `synthetic-query-${owner}`, rank: 7 },
    practical: { hours: "unknown", cost: "unknown" },
  };
}
async function setup(
  page: Page,
  options: { memory?: boolean; corrupt?: string; pending?: boolean; history?: boolean } = {},
) {
  let account = alice;
  const trips = { [alice.id]: trip(alice.id, "lisbon"), [bob.id]: trip(bob.id, "porto") };
  const chatId = (owner: string) => `hosted-chat-${owner}`;
  const calls: Call[] = [];
  await page.route("**/api/account", (route) => route.fulfill({ json: { account } }));
  await page.route("**/api/health", (route) => {
    calls.push(capture(route.request()));
    return route.fulfill({ json: { providers: { openai: true, qloo: true }, mode: "configured" } });
  });
  // Explicit synthetic account resources: no registration, account cookie or paid provider is used.
  await page.route("**/api/saved", (route) =>
    route.fulfill({ json: { workspace: null, revision: 0, updatedAt: null } }),
  );
  await page.route("**/api/trips", (route) => route.fulfill({ json: { trips: [] } }));
  await page.route("**/api/profile", (route) =>
    route.fulfill({ json: { profile: null, revision: 0 } }),
  );
  const profiles = { [alice.id]: profile(alice.id), [bob.id]: profile(bob.id) };
  await page.addInitScript(
    ({ alice, bob, trips, profiles, options }) => {
      for (const owner of [alice.id, bob.id]) {
        if (!localStorage.getItem(`tastip.trip.v1:${owner}`))
          localStorage.setItem(`tastip.trip.v1:${owner}`, JSON.stringify(trips[owner]));
        if (!localStorage.getItem(`tastip.reference.profile:${owner}`))
          localStorage.setItem(
            `tastip.reference.profile:${owner}`,
            JSON.stringify(profiles[owner]),
          );
        if (!localStorage.getItem(`tastip.reference.settings:${owner}`))
          localStorage.setItem(
            `tastip.reference.settings:${owner}`,
            options.corrupt ??
              JSON.stringify({
                assistant: { voice: "marin", style: "neutral", memory: options.memory ?? true },
              }),
          );
        if (!localStorage.getItem(`tastip.reference.chats:${owner}`))
          localStorage.setItem(
            `tastip.reference.chats:${owner}`,
            JSON.stringify([
              {
                id: `hosted-chat-${owner}`,
                tripId: trips[owner]!.id,
                title: "Synthetic owned conversation",
                updatedAt: 1,
                ...(options.pending
                  ? { pendingMessage: "Synthetic pending private request." }
                  : {}),
                messages: options.history
                  ? [
                      { id: "stored-user", role: "user", text: "Synthetic stored question." },
                      {
                        id: "stored-assistant",
                        role: "assistant",
                        text: "Synthetic stored final reply.",
                      },
                    ]
                  : [],
              },
            ]),
          );
      }
    },
    { alice, bob, trips, profiles, options },
  );
  return {
    trips,
    calls,
    chatId,
    setAccount(next: typeof alice) {
      account = next;
    },
  };
}
function headerChat(page: Page) {
  return page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true });
}
async function openPrimary(page: Page) {
  await headerChat(page).click();
  const chat = page.getByRole("region", { name: "Planner chat", exact: true });
  await expect(chat).toBeVisible();
  return chat;
}
async function openDay(chat: ReturnType<Page["getByRole"]>) {
  await chat.getByRole("button", { name: "Places for Day 2", exact: true }).click();
  return chat.getByRole("region", { name: "Suggestions for this day", exact: true });
}

test("phone primary requests carry the rendered owner on health, chat, day recommendations and voice while memory stays off", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  const fixture = await setup(page, { memory: false });
  await page.route("**/api/chat", (route) => {
    fixture.calls.push(capture(route.request()));
    return route.fulfill({
      json: { provider: "openai", message: "Synthetic owned inline reply." },
    });
  });
  await page.route("**/api/taste", (route) => {
    fixture.calls.push(capture(route.request()));
    return route.fulfill({
      json: {
        provider: "qloo",
        queryId: candidate(alice.id).taste!.queryId,
        selected: [candidate(alice.id)],
      },
    });
  });
  await page.route("**/api/voice/session", (route) => {
    fixture.calls.push(capture(route.request()));
    return route.fulfill({
      status: 503,
      json: { error: { message: "Synthetic voice stop before microphone." } },
    });
  });
  await page.goto("/home?day=day-2");
  const chat = await openPrimary(page);
  await chat
    .getByRole("textbox", { name: "Message your travel companion", exact: true })
    .fill("Help me review this explicit trip.");
  await chat.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(chat.locator(".chat-message.assistant-message")).toContainText(
    "Synthetic owned inline reply.",
  );
  const tray = await openDay(chat);
  await tray.getByRole("button", { name: "Find places for this day", exact: true }).click();
  await expect(tray.getByRole("article")).toContainText(candidate(alice.id).name);
  await chat.getByRole("button", { name: "Talk to Tastip", exact: true }).click();
  await chat.getByRole("button", { name: "Start voice call", exact: true }).click();
  await expect(chat.getByRole("alert")).toContainText("Synthetic voice stop before microphone.");
  expect(fixture.calls.filter((call) => call.path === "/api/health").length).toBeGreaterThan(0);
  expect(fixture.calls.every((call) => call.owner === alice.id)).toBe(true);
  const chatCall = fixture.calls.find((call) => call.path === "/api/chat")!;
  expect(chatCall.body?.trip?.id).toBe(fixture.trips[alice.id]!.id);
  expect(chatCall.body?.preferences?.memory).toBe(false);
  expect(chatCall.body?.travelPreferences).toBeUndefined();
  const dayCall = fixture.calls.find((call) => call.path === "/api/taste")!;
  expect(dayCall.body).toMatchObject({
    entityIds: [favorites[alice.id]!.id],
    destinationId: "lisbon",
  });
  expect(fixture.calls.find((call) => call.path === "/api/voice/session")?.body?.trip?.id).toBe(
    fixture.trips[alice.id]!.id,
  );
  expect(
    await page.evaluate(
      (owner) => JSON.parse(localStorage.getItem(`tastip.trip.v1:${owner}`) ?? "null"),
      alice.id,
    ),
  ).toEqual(fixture.trips[alice.id]);
});

test("full chat health and reply requests capture their rendered owner and only that owner's explicit context", async ({
  page,
}) => {
  const fixture = await setup(page, { memory: true });
  await page.route("**/api/chat", (route) => {
    fixture.calls.push(capture(route.request()));
    return route.fulfill({
      json: { provider: "openai", message: "Synthetic owned full-chat reply." },
    });
  });
  await page.goto(`/chat/${fixture.chatId(alice.id)}`);
  const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
  await conversation.getByRole("textbox").fill("Review this owned full conversation.");
  await conversation.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(conversation.locator(".chat-message.assistant-message")).toContainText(
    "Synthetic owned full-chat reply.",
  );
  expect(fixture.calls.filter((call) => call.path === "/api/health").length).toBeGreaterThan(0);
  expect(fixture.calls.every((call) => call.owner === alice.id)).toBe(true);
  const request = fixture.calls.find((call) => call.path === "/api/chat")!;
  expect(request.body?.trip?.id).toBe(fixture.trips[alice.id]!.id);
  expect(request.body?.preferences?.memory).toBe(true);
  expect(request.body?.travelPreferences).toContain(profile(alice.id).notes);
  expect(JSON.stringify(request.body)).not.toContain(profile(bob.id).notes);
});

test("switching owners cancels Alice's pending chat and day results without relabeling her inputs as Bob", async ({
  page,
}) => {
  const fixture = await setup(page, { memory: true });
  const releases: (() => void)[] = [];
  const finished: Promise<void>[] = [];
  for (const path of ["chat", "taste"]) {
    await page.route(`**/api/${path}`, async (route) => {
      const call = capture(route.request());
      fixture.calls.push(call);
      if (call.owner === alice.id) {
        let release = () => {};
        let finish = () => {};
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        finished.push(
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        );
        releases.push(release);
        await gate;
        try {
          await route.fulfill({
            json:
              path === "chat"
                ? { provider: "openai", message: "Private Alice late reply must be discarded." }
                : {
                    provider: "qloo",
                    queryId: candidate(alice.id).taste!.queryId,
                    selected: [candidate(alice.id)],
                  },
          });
        } catch {
          /* Owner changes abort the old request. */
        } finally {
          finish();
        }
      } else {
        await route.fulfill({
          json:
            path === "chat"
              ? { provider: "openai", message: "Bob's explicit current reply." }
              : {
                  provider: "qloo",
                  queryId: candidate(bob.id).taste!.queryId,
                  selected: [candidate(bob.id)],
                },
        });
      }
    });
  }
  try {
    await page.goto("/?day=day-2");
    let chat = await openPrimary(page);
    await chat.getByRole("textbox").fill("Private Alice request that stays owned by Alice.");
    await chat.getByRole("button", { name: "Send message", exact: true }).click();
    const aliceTray = await openDay(chat);
    await aliceTray.getByRole("button", { name: "Find places for this day", exact: true }).click();
    await expect.poll(() => releases.length).toBe(2);
    fixture.setAccount(bob);
    await page.evaluate(() =>
      window.dispatchEvent(new StorageEvent("storage", { key: "tastip.session.change.v1" })),
    );
    await expect(
      page.getByRole("button", { name: `Account ${bob.username}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(fixture.trips[bob.id]!.title!);
    await expect(headerChat(page)).toHaveAttribute("aria-expanded", "false");
    for (const release of releases) release();
    await Promise.all(finished);
    chat = await openPrimary(page);
    await expect(chat.locator(".chat-message")).toHaveCount(0);
    await chat.getByRole("textbox").fill("Bob's explicit new request.");
    await chat.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(chat.locator(".chat-message.assistant-message")).toContainText(
      "Bob's explicit current reply.",
    );
    const bobTray = await openDay(chat);
    await expect(bobTray.getByRole("article")).toHaveCount(0);
    await bobTray.getByRole("button", { name: "Find places for this day", exact: true }).click();
    await expect(bobTray.getByRole("article")).toContainText(candidate(bob.id).name);
    const requests = fixture.calls.filter((call) => call.path !== "/api/health");
    expect(requests).toHaveLength(4);
    for (const request of requests) {
      if (request.path === "/api/chat") {
        expect(request.body?.trip?.id).toBe(fixture.trips[request.owner!]!.id);
        expect(request.body?.travelPreferences).toContain(profile(request.owner!).notes);
      } else {
        expect(request.body?.entityIds).toEqual([favorites[request.owner!]!.id]);
        expect(request.body?.destinationId).toBe(request.owner === alice.id ? "lisbon" : "porto");
      }
    }
    expect(fixture.calls.some((call) => call.path === "/api/health" && call.owner === bob.id)).toBe(
      true,
    );
    const copies = await page.evaluate(
      ({ alice, bob }) => ({
        alice: localStorage.getItem(`tastip.reference.chats:${alice}`),
        bob: localStorage.getItem(`tastip.reference.chats:${bob}`),
      }),
      { alice: alice.id, bob: bob.id },
    );
    expect(copies.alice).toContain("Private Alice request that stays owned by Alice.");
    expect(copies.alice).not.toContain("Private Alice late reply must be discarded.");
    expect(copies.bob).not.toContain("Private Alice");
    await expect(page.getByText(candidate(alice.id).name, { exact: true })).toHaveCount(0);
  } finally {
    for (const release of releases) release();
  }
});

test("owned unreadable settings retain pending history and composer without provider transmission", async ({
  page,
}) => {
  const corrupt = '{\n "assistant": { "memory": "unreadable-owner-setting" }\n}';
  const fixture = await setup(page, { corrupt, pending: true, history: true });
  for (const path of ["chat", "taste", "voice/session"])
    await page.route(`**/api/${path}`, (route) => {
      fixture.calls.push(capture(route.request()));
      return route.fulfill({
        status: 503,
        json: { error: { message: "Unexpected owned provider call." } },
      });
    });
  await page.goto("/");
  let chat = await openPrimary(page);
  await expect(chat.getByRole("alert")).toContainText("saved preferences could not be read");
  await expect(chat.locator(".chat-message.assistant-message")).toContainText(
    "Synthetic stored final reply.",
  );
  const composer = chat.getByRole("textbox", {
    name: "Message your travel companion",
    exact: true,
  });
  await composer.fill("Keep this owned unsent private composer.");
  await composer.press("Enter");
  await expect(chat.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
  await expect(chat.getByRole("button", { name: "Talk to Tastip", exact: true })).toBeDisabled();
  await chat.getByRole("button", { name: "Close planner chat", exact: true }).click();
  chat = await openPrimary(page);
  await expect(composer).toHaveValue("Keep this owned unsent private composer.");
  expect(
    fixture.calls.every((call) => call.path === "/api/health" && call.owner === alice.id),
  ).toBe(true);
  const copies = await page.evaluate(
    (owner) => ({
      settings: localStorage.getItem(`tastip.reference.settings:${owner}`),
      chats: JSON.parse(localStorage.getItem(`tastip.reference.chats:${owner}`) ?? "[]"),
    }),
    alice.id,
  );
  expect(copies.settings).toBe(corrupt);
  expect(copies.chats[0].pendingMessage).toBe("Synthetic pending private request.");
  expect(copies.chats[0].messages).toHaveLength(2);
});
