import { expect, type Page, test } from "@playwright/test";

type VoiceFixture = {
  sent: Record<string, unknown>[];
  microphoneRequests: number;
  stopped: boolean;
  emit(event: unknown): void;
};

async function voiceFixture(page: Page, denyMicrophone = false) {
  // Synthetic WebRTC/provider boundary only; no real microphone or OpenAI request is made.
  await page.addInitScript(
    ({ denied }) => {
      const fixture: VoiceFixture = {
        sent: [],
        microphoneRequests: 0,
        stopped: false,
        emit: () => {},
      };
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
            if (denied) throw new DOMException("Synthetic microphone denial", "NotAllowedError");
            return { getTracks: () => [track], getAudioTracks: () => [track] };
          },
        },
      });
      class Channel {
        readyState = "connecting";
        onopen: (() => void) | null = null;
        onclose: (() => void) | null = null;
        onmessage: ((event: { data: string }) => void) | null = null;
        send(value: string) {
          fixture.sent.push(JSON.parse(value));
        }
        close() {
          this.readyState = "closed";
          this.onclose?.();
        }
      }
      class Connection {
        connectionState = "new";
        channel = new Channel();
        createDataChannel() {
          fixture.emit = (event) => this.channel.onmessage?.({ data: JSON.stringify(event) });
          return this.channel;
        }
        addTrack() {}
        async createOffer() {
          return { type: "offer", sdp: "synthetic-offer" };
        }
        async setLocalDescription() {}
        async setRemoteDescription() {
          this.connectionState = "connected";
          this.channel.readyState = "open";
          this.channel.onopen?.();
        }
        close() {
          this.connectionState = "closed";
        }
      }
      Object.assign(window, { RTCPeerConnection: Connection, __tastipVoice: fixture });
    },
    { denied: denyMicrophone },
  );
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo: false }, mode: "demo" } }),
  );
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({
      json: {
        clientSecret: "synthetic-ephemeral",
        expiresAt: 123456,
        model: "synthetic-voice-fixture",
      },
    }),
  );
  await page.route("https://api.openai.com/v1/realtime/calls", (route) =>
    route.fulfill({
      contentType: "application/sdp",
      body: "synthetic-answer",
      headers: { "Access-Control-Allow-Origin": "*" },
    }),
  );
}

async function openVoice(page: Page) {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "Talk to Tastip", exact: true }).click();
  await page.getByRole("button", { name: "Start voice call", exact: true }).click();
}

async function emit(page: Page, event: unknown) {
  await page.evaluate(
    (value) => (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.emit(value),
    event,
  );
}

test("voice proposals require Apply, deduplicate, reject stale edits and preserve undo", async ({
  page,
}) => {
  await voiceFixture(page);
  await openVoice(page);
  await expect(page.getByRole("button", { name: "Mute microphone", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  await emit(page, { type: "response.created" });
  await page.getByRole("button", { name: "Interrupt assistant", exact: true }).click();
  expect(
    await page.evaluate(() =>
      (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.sent.some(
        (item) => item.type === "response.cancel",
      ),
    ),
  ).toBe(true);
  const trip = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  const completed = {
    type: "response.done",
    response: {
      status: "completed",
      output: [
        {
          type: "function_call",
          name: "propose_itinerary_edit",
          call_id: "call_browser_review",
          arguments: JSON.stringify({
            tripId: trip.id,
            baseVersion: trip.version,
            summary: "Start the café visit at 10:00.",
            operations: [{ type: "set-start-time", stopId: trip.stops[0].id, startTime: "10:00" }],
          }),
        },
      ],
    },
  };
  await emit(page, completed);
  await emit(page, completed);
  await expect(page.getByText("Review trip change", { exact: true })).toHaveCount(1);
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "09:30",
  );
  const pending = await page.evaluate(() =>
    (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.sent.filter(
      (item) =>
        item.type === "conversation.item.create" &&
        (item.item as { type?: string })?.type === "function_call_output",
    ),
  );
  expect(pending).toHaveLength(1);
  const toolOutput = pending[0]?.item as { output: string } | undefined;
  expect(JSON.parse(toolOutput?.output ?? "{}").status).toBe("pending_review");
  await page.getByRole("button", { name: "Apply change", exact: true }).click();
  await expect(page.getByText("Applied · draft v2", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "10:00",
  );
  completed.response.output[0]!.call_id = "call_stale_review";
  await emit(page, completed);
  await expect(page.getByRole("alert").filter({ hasText: "Your plan changed" })).toBeVisible();
  await expect(page.getByText("Review trip change", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "End", exact: true }).click();
  expect(
    await page.evaluate(
      () => (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.stopped,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "09:30",
  );
  await page.reload();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "09:30",
  );
});

test("unavailable voice never requests microphone access and leaves text usable", async ({
  page,
}) => {
  await voiceFixture(page);
  await page.route("**/api/voice/session", (route) =>
    route.fulfill({
      status: 503,
      json: { error: { message: "Voice is unavailable in this contract fixture." } },
    }),
  );
  await openVoice(page);
  await expect(page.getByRole("alert").filter({ hasText: "Voice is unavailable" })).toBeVisible();
  expect(
    await page.evaluate(
      () => (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.microphoneRequests,
    ),
  ).toBe(0);
  await page.getByLabel("Message your travel companion").fill("Pin Demo · Slow Morning Café");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Review trip change", { exact: true })).toBeVisible();
});

test("denied microphone access is recoverable and does not start a connection", async ({
  page,
}) => {
  await voiceFixture(page, true);
  await openVoice(page);
  await expect(
    page.getByRole("alert").filter({ hasText: "Microphone access was denied" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Start voice call", exact: true })).toBeEnabled();
  expect(
    await page.evaluate(
      () => (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.microphoneRequests,
    ),
  ).toBe(1);
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "09:30",
  );
});

test("voice stays interruptible while completed response audio drains, including while muted", async ({
  page,
}) => {
  await voiceFixture(page);
  await openVoice(page);
  await expect(page.locator(".voice-status")).toHaveText("listening");
  await emit(page, { type: "response.created" });
  await emit(page, { type: "output_audio_buffer.started" });
  await emit(page, { type: "response.done", response: { status: "completed", output: [] } });
  await expect(page.locator(".voice-status")).toHaveText("speaking");
  await page.getByRole("button", { name: "Mute microphone", exact: true }).click();
  await expect(page.locator(".voice-status")).toHaveText("speaking");
  await page.getByRole("button", { name: "Interrupt assistant", exact: true }).click();
  await expect(page.locator(".voice-status")).toHaveText("muted");
  const cancelled = await page.evaluate(() => {
    const fixture = (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice;
    return fixture.sent
      .slice()
      .reverse()
      .find((event) => event.type === "response.cancel");
  });
  expect(cancelled?.event_id).toBeTruthy();
  await emit(page, {
    type: "error",
    error: { code: "response_cancel_not_active", event_id: cancelled?.event_id },
  });
  await expect(page.locator(".voice-status")).toHaveText("muted");
  expect(
    await page.evaluate(
      () => (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.stopped,
    ),
  ).toBe(false);
  await page.getByRole("button", { name: "Unmute microphone", exact: true }).click();
  await emit(page, { type: "response.created" });
  await emit(page, { type: "output_audio_buffer.started" });
  await emit(page, { type: "response.done", response: { status: "completed", output: [] } });
  await expect(page.locator(".voice-status")).toHaveText("speaking");
  await emit(page, { type: "output_audio_buffer.stopped" });
  await expect(page.locator(".voice-status")).toHaveText("listening");
  await page.getByRole("button", { name: "End", exact: true }).click();
});

test("unrelated voice errors still stop media instead of being mistaken for cancellation races", async ({
  page,
}) => {
  await voiceFixture(page);
  await openVoice(page);
  await expect(page.locator(".voice-status")).toHaveText("listening");
  await emit(page, { type: "response.created" });
  await page.getByRole("button", { name: "Interrupt assistant", exact: true }).click();
  const cancelled = await page.evaluate(() =>
    (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.sent
      .slice()
      .reverse()
      .find((event) => event.type === "response.cancel"),
  );
  await emit(page, {
    type: "error",
    error: { code: "server_error", event_id: cancelled?.event_id },
  });
  await expect(page.locator(".voice-status")).toHaveText("error");
  expect(
    await page.evaluate(
      () => (window as unknown as { __tastipVoice: VoiceFixture }).__tastipVoice.stopped,
    ),
  ).toBe(true);
  await expect(page.getByRole("button", { name: "Start voice call", exact: true })).toBeEnabled();
});
