import { expect, type Page, test } from "@playwright/test";
import type { Conversation } from "../../apps/web/src/features/planner/lib/conversations";
import { createDemoTrip, DEFAULT_BRIEF, type Trip } from "../../packages/domain/src";

const settingsKey = "tastip.reference.settings:guest";
const profileKey = "tastip.reference.profile:guest";
const chatsKey = "tastip.reference.chats:guest";
const profile = {
  firstName: "PrivatePreferencesFixture",
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
  notes: "Synthetic private profile must stay local when settings are unreadable.",
};
function headerChat(page: Page) {
  return page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true });
}
async function openPrimary(page: Page) {
  await headerChat(page).click();
  const conversation = page
    .getByRole("region", { name: "Planner chat", exact: true })
    .getByRole("region", { name: "Travel conversation", exact: true });
  await expect(conversation).toBeVisible();
  return conversation;
}
function history(trip?: Trip, pending = true): Conversation {
  return {
    id: "preferences-privacy-fixture",
    title: "Synthetic private history",
    ...(trip ? { tripId: trip.id } : {}),
    updatedAt: 1,
    ...(pending ? { pendingMessage: "Synthetic pending request must not auto-send." } : {}),
    messages: [
      { id: "old-user", role: "user", text: "Synthetic earlier request." },
      { id: "old-assistant", role: "assistant", text: "Synthetic earlier completed reply." },
    ],
  };
}
async function setup(page: Page, rawSettings: string, trip?: Trip, chat = history(trip)) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo: false } } }),
  );
  await page.addInitScript(
    ({ rawSettings, trip, chat, profile, settingsKey, profileKey, chatsKey }) => {
      if (!localStorage.getItem(settingsKey)) localStorage.setItem(settingsKey, rawSettings);
      localStorage.setItem(profileKey, JSON.stringify(profile));
      if (trip && !localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      if (!localStorage.getItem(chatsKey)) localStorage.setItem(chatsKey, JSON.stringify([chat]));
    },
    { rawSettings, trip, chat, profile, settingsKey, profileKey, chatsKey },
  );
  return chat;
}
async function blockProviderSpies(page: Page) {
  const calls: { endpoint: string; body: unknown }[] = [];
  for (const endpoint of ["chat", "voice/session"]) {
    await page.route(`**/api/${endpoint}`, async (route) => {
      calls.push({ endpoint, body: route.request().postDataJSON() });
      await route.fulfill({
        status: 503,
        json: { error: { message: "Unexpected synthetic provider call." } },
      });
    });
  }
  return calls;
}

for (const [width, rawSettings] of [
  [375, "{synthetic unreadable settings bytes"],
  [1440, '{\n "assistant": { "memory": "invalid-private-setting" }\n}'],
] as const) {
  test(`primary unreadable preferences keep history, composer and pending bytes without text or voice requests at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const chat = await setup(page, rawSettings, trip);
    const calls = await blockProviderSpies(page);
    await page.goto("/");
    let conversation = await openPrimary(page);
    await expect(conversation.getByRole("alert")).toContainText(
      "saved preferences could not be read",
    );
    await expect(conversation.locator(".chat-message.assistant-message")).toContainText(
      "Synthetic earlier completed reply.",
    );
    const composer = conversation.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await composer.fill("Keep this private unsent composer draft.");
    await expect(
      conversation.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    await expect(
      conversation.getByRole("button", { name: "Talk to Tastip", exact: true }),
    ).toBeDisabled();
    await composer.press("Enter");
    await page.getByRole("button", { name: "Close planner chat", exact: true }).click();
    conversation = await openPrimary(page);
    await expect(composer).toHaveValue("Keep this private unsent composer draft.");
    await expect(
      conversation.getByRole("link", { name: "Review preferences in Settings", exact: true }),
    ).toHaveAttribute("href", "/settings?section=personalization");
    expect(calls).toEqual([]);
    const copies = await page.evaluate(
      ({ settingsKey, profileKey, chatsKey }) => ({
        settings: localStorage.getItem(settingsKey),
        profile: localStorage.getItem(profileKey),
        chats: localStorage.getItem(chatsKey),
        trip: JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
      }),
      { settingsKey, profileKey, chatsKey },
    );
    expect(copies.settings).toBe(rawSettings);
    expect(copies.profile).toBe(JSON.stringify(profile));
    expect(copies.chats).toBe(JSON.stringify([chat]));
    expect(copies.trip).toEqual(trip);
  });
}

test("full conversation leaves pending history untouched when preferences cannot be checked", async ({
  page,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const rawSettings = '{"assistant":{"voice":"unknown-voice","memory":true}}';
  const chat = await setup(page, rawSettings, trip);
  const calls = await blockProviderSpies(page);
  await page.goto(`/chat/${chat.id}`);
  const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
  await expect(conversation.getByRole("alert")).toContainText(
    "saved preferences could not be read",
  );
  await expect(conversation.locator(".chat-message.assistant-message")).toContainText(
    "Synthetic earlier completed reply.",
  );
  await conversation.getByRole("textbox").fill("Keep this full-chat composer draft.");
  await conversation.getByRole("textbox").press("Enter");
  await expect(
    conversation.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await expect(
    conversation.getByRole("button", { name: "Talk to Tastip", exact: true }),
  ).toBeDisabled();
  expect(calls).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(rawSettings);
  expect(await page.evaluate((key) => localStorage.getItem(key), chatsKey)).toBe(
    JSON.stringify([chat]),
  );
  await expect(conversation.getByRole("textbox")).toHaveValue(
    "Keep this full-chat composer draft.",
  );
});

test("the reference voice modal respects unreadable preference availability", async ({ page }) => {
  const rawSettings = "{synthetic unreadable voice preferences";
  await setup(page, rawSettings, undefined, history(undefined, false));
  const calls = await blockProviderSpies(page);
  await page.goto("/discover");
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Talk to Tastip", exact: true });
  await expect(dialog.getByRole("alert")).toContainText("saved preferences could not be read");
  await expect(dialog.getByRole("button", { name: "Talk to Tastip", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Start voice call", exact: true })).toHaveCount(
    0,
  );
  expect(calls).toEqual([]);
  expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(rawSettings);
});

test("a newly unreadable preference copy stops an active reply and keeps its unanswered history and composer", async ({
  page,
  context,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  await setup(page, "{}", trip, history(trip, false));
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const bodies: unknown[] = [];
  await page.route("**/api/chat", async (route) => {
    bodies.push(route.request().postDataJSON());
    await gate;
    try {
      await route.fulfill({
        json: { provider: "openai", message: "Discard this late preference reply." },
      });
    } catch {
      /* The preference invalidation aborts the request. */
    } finally {
      finish();
    }
  });
  const other = await context.newPage();
  try {
    await page.goto("/");
    const conversation = await openPrimary(page);
    await conversation.getByRole("textbox").fill("A synthetic request before preferences changed.");
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => bodies.length).toBe(1);
    await conversation.getByRole("textbox").fill("Keep the next unsent private question.");
    await other.goto("/settings");
    const rawSettings = "{synthetic preferences changed in another tab";
    await other.evaluate(({ key, raw }) => localStorage.setItem(key, raw), {
      key: settingsKey,
      raw: rawSettings,
    });
    await expect(conversation.getByRole("alert")).toContainText(
      "saved preferences could not be read",
    );
    await expect(
      conversation.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
    release();
    await finished;
    await expect(
      conversation
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Discard this late preference reply." }),
    ).toHaveCount(0);
    await expect(conversation.getByRole("textbox")).toHaveValue(
      "Keep the next unsent private question.",
    );
    await conversation.getByRole("textbox").press("Enter");
    expect(bodies).toHaveLength(1);
    const chats: Conversation[] = await page.evaluate(
      (key) => JSON.parse(localStorage.getItem(key) ?? "[]"),
      chatsKey,
    );
    expect(chats[0]?.messages.at(-1)?.text).toBe("A synthetic request before preferences changed.");
    expect(await page.evaluate((key) => localStorage.getItem(key), settingsKey)).toBe(rawSettings);
  } finally {
    release();
    await other.close();
  }
});

test("closing chat after entry-to-trip acceptance focuses the persistent header trigger", async ({
  page,
}) => {
  const chat: Conversation = {
    id: "entry-acceptance-focus",
    title: "Synthetic focus trip",
    updatedAt: 1,
    messages: [
      { id: "request", role: "user", text: "Lisbon for 2 days with 1 adult" },
      { id: "reply", role: "assistant", text: "Review the details." },
    ],
  };
  await setup(page, "{}", undefined, chat);
  const calls = await blockProviderSpies(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Talk through an idea", exact: true }).click();
  await page.getByRole("button", { name: "Build this trip", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Create a trip", exact: true })
    .getByRole("button", { name: "Review trip", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Review your personal trip", exact: true })
    .getByRole("button", { name: "Create blank draft", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Your floating day journey", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close planner chat", exact: true }).click();
  await expect(headerChat(page)).toBeFocused();
  expect(calls).toEqual([]);
});

test("unreadable preferences end an active voice connection and stop its microphone", async ({
  page,
  context,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  await setup(page, "{}", trip, history(trip, false));
  await page.addInitScript(() => {
    const fixture = { stopped: false, closed: false, microphoneRequests: 0 };
    const track = {
      enabled: true,
      stop: () => {
        fixture.stopped = true;
      },
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          fixture.microphoneRequests++;
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      },
    });
    class Channel {
      readyState = "connecting";
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
      onmessage: ((event: { data: string }) => void) | null = null;
      send() {}
      close() {
        this.readyState = "closed";
        this.onclose?.();
      }
    }
    class Connection {
      connectionState = "new";
      channel = new Channel();
      createDataChannel() {
        return this.channel;
      }
      addTrack() {}
      async createOffer() {
        return { type: "offer", sdp: "synthetic-privacy-offer" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        this.connectionState = "connected";
        this.channel.readyState = "open";
        this.channel.onopen?.();
      }
      close() {
        this.connectionState = "closed";
        fixture.closed = true;
      }
    }
    Object.assign(window, { RTCPeerConnection: Connection, __privacyVoiceFixture: fixture });
  });
  let voiceCalls = 0;
  await page.route("**/api/voice/session", (route) => {
    voiceCalls++;
    return route.fulfill({
      json: {
        clientSecret: "synthetic-privacy-secret",
        expiresAt: 123456,
        model: "synthetic-privacy-model",
      },
    });
  });
  await page.route("https://api.openai.com/v1/realtime/calls", (route) =>
    route.fulfill({
      contentType: "application/sdp",
      body: "synthetic-privacy-answer",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
  const other = await context.newPage();
  try {
    await page.goto("/");
    const conversation = await openPrimary(page);
    await conversation.getByRole("button", { name: "Talk to Tastip", exact: true }).click();
    await conversation.getByRole("button", { name: "Start voice call", exact: true }).click();
    await expect(
      conversation.getByRole("button", { name: "Mute microphone", exact: true }),
    ).toBeVisible();
    expect(voiceCalls).toBe(1);
    await other.goto("/settings");
    await other.evaluate(
      (key) => localStorage.setItem(key, "{synthetic unreadable settings during voice"),
      settingsKey,
    );
    await expect(conversation.getByRole("alert")).toContainText(
      "saved preferences could not be read",
    );
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __privacyVoiceFixture: { stopped: boolean } })
              .__privacyVoiceFixture.stopped,
        ),
      )
      .toBe(true);
    const fixture = await page.evaluate(
      () =>
        (
          window as unknown as {
            __privacyVoiceFixture: { closed: boolean; microphoneRequests: number };
          }
        ).__privacyVoiceFixture,
    );
    expect(fixture.closed).toBe(true);
    expect(fixture.microphoneRequests).toBe(1);
    await expect(
      conversation.getByRole("button", { name: "Talk to Tastip", exact: true }),
    ).toBeDisabled();
    await expect(
      conversation.getByRole("button", { name: "Start voice call", exact: true }),
    ).toHaveCount(0);
    expect(voiceCalls).toBe(1);
  } finally {
    await other.close();
  }
});
