import { expect, type Page, test } from "@playwright/test";
import type { Conversation } from "../../apps/web/src/features/planner/lib/conversations";
import { createDemoTrip, DEFAULT_BRIEF, type Trip } from "../../packages/domain/src";

function headerChat(page: Page) {
  return page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true });
}
async function seed(page: Page, trip: Trip, chats: Conversation[] = []) {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo: false } } }),
  );
  await page.addInitScript(
    ({ trip, chats }) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      if (!localStorage.getItem("tastip.reference.chats:guest"))
        localStorage.setItem("tastip.reference.chats:guest", JSON.stringify(chats));
    },
    { trip, chats },
  );
}
function panel(page: Page) {
  return page.getByRole("region", { name: "Planner chat", exact: true });
}
async function storedChats(page: Page): Promise<Conversation[]> {
  return page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]"),
  );
}

for (const width of [375, 1440]) {
  test(`a hidden planner chat sends a stored entry only after opening at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const pending = "Synthetic pending planner request";
    await seed(page, trip, [
      {
        id: "synthetic-pending-planner-chat",
        title: "Synthetic pending chat",
        tripId: trip.id,
        updatedAt: 1,
        pendingMessage: pending,
        messages: [],
      },
    ]);
    const requests: { message: string }[] = [];
    await page.route("**/api/chat", (route) => {
      requests.push(route.request().postDataJSON());
      return route.fulfill({
        json: { provider: "openai", message: "Synthetic opened-chat reply" },
      });
    });
    await page.goto("/home?day=day-2");
    await expect(headerChat(page)).toBeEnabled();
    await expect(headerChat(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    expect(requests).toEqual([]);
    expect((await storedChats(page))[0]?.pendingMessage).toBe(pending);
    await headerChat(page).click();
    await expect(
      panel(page)
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Synthetic opened-chat reply" }),
    ).toBeVisible();
    expect(requests.map((request) => request.message)).toEqual([pending]);
    await expect(panel(page).locator(".chat-message.user-message")).toHaveCount(1);
    await panel(page).getByRole("button", { name: "Close planner chat", exact: true }).click();
    await headerChat(page).click();
    await expect(
      panel(page)
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Synthetic opened-chat reply" }),
    ).toBeVisible();
    expect(requests).toHaveLength(1);
  });

  test(`closing a planner reply aborts late output and preserves explicit retry and composer at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const trip = createDemoTrip(DEFAULT_BRIEF);
    await seed(page, trip);
    const requests: { message: string; history: unknown[] }[] = [];
    let release = () => {};
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route("**/api/chat", async (route) => {
      const first = requests.length === 0;
      requests.push(route.request().postDataJSON());
      if (first)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      try {
        await route.fulfill({
          json: {
            provider: "openai",
            message: first ? "Synthetic late hidden reply" : "Synthetic retried planner reply",
          },
        });
      } catch {
        // A cancelled browser request may reject a delayed synthetic response.
      } finally {
        if (first) finish();
      }
    });
    await page.goto("/home?day=day-2");
    await headerChat(page).click();
    const conversation = panel(page).getByRole("region", {
      name: "Travel conversation",
      exact: true,
    });
    const composer = conversation.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await composer.fill("Synthetic request to retry explicitly");
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => requests.length).toBe(1);
    await composer.fill("Keep this separate unsent composer question");
    await panel(page).getByRole("button", { name: "Close planner chat", exact: true }).click();
    await expect(headerChat(page)).toHaveAttribute("aria-expanded", "false");
    await expect(panel(page)).toBeHidden();
    release();
    await finished;
    await headerChat(page).click();
    await expect(composer).toHaveValue("Keep this separate unsent composer question");
    await expect(
      conversation.getByRole("button", { name: "Retry reply", exact: true }),
    ).toBeVisible();
    await expect(conversation.locator(".chat-message.assistant-message")).toHaveCount(0);
    expect(requests).toHaveLength(1);
    await conversation.getByRole("button", { name: "Retry reply", exact: true }).click();
    await expect(
      conversation
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Synthetic retried planner reply" }),
    ).toBeVisible();
    await expect(
      conversation
        .locator(".chat-message.assistant-message")
        .filter({ hasText: "Synthetic late hidden reply" }),
    ).toHaveCount(0);
    await expect(conversation.locator(".chat-message.user-message")).toHaveCount(1);
    await expect(composer).toHaveValue("Keep this separate unsent composer question");
    expect(requests).toHaveLength(2);
    expect(requests[1]?.message).toBe(requests[0]?.message);
    expect(requests[1]?.history).toEqual([]);
    await expect.poll(async () => (await storedChats(page))[0]?.messages.length).toBe(2);
    expect((await storedChats(page))[0]?.messages.map((message) => message.role)).toEqual([
      "user",
      "assistant",
    ]);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
  });
}

type VoiceProbe = {
  microphoneRequests: number;
  stopped: number;
  closed: number;
  answersApplied: number;
};
async function fakeVoice(page: Page) {
  // Synthetic WebRTC boundary: these tests never request the real microphone.
  await page.addInitScript(() => {
    const probe: VoiceProbe = { microphoneRequests: 0, stopped: 0, closed: 0, answersApplied: 0 };
    const track = {
      enabled: true,
      stop: () => {
        probe.stopped++;
      },
    };
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => {
          probe.microphoneRequests++;
          return { getTracks: () => [track], getAudioTracks: () => [track] };
        },
      },
    });
    class Channel {
      readyState = "connecting";
      onopen: (() => void) | null = null;
      onclose: (() => void) | null = null;
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
        return { type: "offer", sdp: "synthetic-planner-offer" };
      }
      async setLocalDescription() {}
      async setRemoteDescription() {
        probe.answersApplied++;
        this.connectionState = "connected";
        this.channel.readyState = "open";
        this.channel.onopen?.();
      }
      close() {
        this.connectionState = "closed";
        probe.closed++;
      }
    }
    Object.assign(window, { RTCPeerConnection: Connection, __plannerChatVoice: probe });
  });
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({
      json: {
        clientSecret: "synthetic-planner-voice-token",
        expiresAt: 123456,
        model: "synthetic-voice-model",
      },
    }),
  );
}
async function voiceProbe(page: Page) {
  return page.evaluate(
    () => (window as unknown as { __plannerChatVoice: VoiceProbe }).__plannerChatVoice,
  );
}
for (const mode of ["connecting", "listening"] as const) {
  test(`closing planner chat while voice is ${mode} stops its microphone and connection`, async ({
    page,
  }) => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    await seed(page, trip);
    await fakeVoice(page);
    let calls = 0;
    let release = () => {};
    let finish = () => {};
    const finished = new Promise<void>((resolve) => {
      finish = resolve;
    });
    await page.route("https://api.openai.com/v1/realtime/calls", async (route) => {
      calls++;
      if (mode === "connecting")
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      try {
        await route.fulfill({
          contentType: "application/sdp",
          body: "synthetic-planner-answer",
          headers: { "Access-Control-Allow-Origin": "*" },
        });
      } catch {
        // Closing the panel aborts the in-flight synthetic SDP exchange.
      } finally {
        finish();
      }
    });
    await page.goto("/home?day=day-1");
    await headerChat(page).click();
    await panel(page).getByRole("button", { name: "Talk to Tastip", exact: true }).click();
    await panel(page).getByRole("button", { name: "Start voice call", exact: true }).click();
    await expect.poll(() => calls).toBe(1);
    expect((await voiceProbe(page)).microphoneRequests).toBe(1);
    if (mode === "listening")
      await expect(
        panel(page).getByRole("button", { name: "Mute microphone", exact: true }),
      ).toBeVisible();
    await panel(page).getByRole("button", { name: "Close planner chat", exact: true }).click();
    await expect.poll(async () => (await voiceProbe(page)).stopped).toBe(1);
    await expect.poll(async () => (await voiceProbe(page)).closed).toBe(1);
    if (mode === "connecting") release();
    await finished;
    await headerChat(page).click();
    await expect(
      panel(page).getByRole("button", { name: "Mute microphone", exact: true }),
    ).toHaveCount(0);
    const probe = await voiceProbe(page);
    expect(probe.microphoneRequests).toBe(1);
    expect(probe.answersApplied).toBe(mode === "listening" ? 1 : 0);
    expect(calls).toBe(1);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
  });
}
