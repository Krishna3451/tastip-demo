import { expect, test } from "bun:test";
import type { TripContext } from "./contracts";
import { createOpenAIProviders } from "./openai";
import { partialAssistantMessage } from "./streamed-message";

type Event = Record<string, unknown> & { type: string };
const encode = new TextEncoder();
const wire = (event: Event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
function delta(text: string): Event {
  return {
    type: "response.output_text.delta",
    delta: text,
    output_index: 0,
    content_index: 0,
    item_id: "message_fixture",
    logprobs: [],
    sequence_number: 1,
  };
}
function completed(text: string): Event {
  return {
    type: "response.completed",
    sequence_number: 2,
    response: {
      id: "resp_fixture",
      object: "response",
      status: "completed",
      output: [
        {
          type: "message",
          id: "message_fixture",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
      ],
    },
  };
}
function response(events: Event[]) {
  return new Response(`${events.map(wire).join("")}data: [DONE]\n\n`, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
function adapter(events: Event[]) {
  return createOpenAIProviders({
    apiKey: "synthetic-stream-test-key",
    fetch: async () => response(events),
  }).conversation;
}

const context: TripContext = {
  tripId: "known-trip",
  version: 4,
  destinationId: "lisbon",
  days: 1,
  partySize: 1,
  interests: [],
  calendar: [{ id: "day-1", date: null, city: "Lisbon", timeZone: "Europe/Lisbon" }],
  places: [{ id: "place-a", name: "Fixture café" }],
  stops: [
    {
      id: "visit-a",
      placeId: "place-a",
      name: "Fixture café",
      day: "Day 1",
      time: "09:30",
      sample: true,
    },
  ],
};

test("partial structured JSON decodes escaped message text across every chunk boundary and skips proposal fields", () => {
  const raw = String.raw`{"proposal":{"summary":"message: private metadata","operations":[]},"message":"A \"quoted\" \\ path\nline\t\uD83D\uDE00"}`;
  // A literal escaped JSON fixture exercises boundaries inside backslashes and Unicode pairs.
  const expected = JSON.parse(raw).message as string;
  let previous = "";
  for (let length = 0; length <= raw.length; length++) {
    const partial = partialAssistantMessage(raw.slice(0, length));
    if (partial === null) continue;
    expect(expected.startsWith(partial)).toBe(true);
    expect(partial.startsWith(previous)).toBe(true);
    expect(partial).not.toContain("private metadata");
    if (partial.length)
      expect(
        partial.charCodeAt(partial.length - 1) < 0xd800 ||
          partial.charCodeAt(partial.length - 1) > 0xdbff,
      ).toBe(true);
    previous = partial;
  }
  expect(previous).toBe(expected);
  for (const malformed of [
    "[]",
    '{"nested":{"message":"not top level"}',
    '{"message":123}',
    '{"unknown":invalid,"message":"hide"}',
    '{"message":"bad\\x"}',
  ])
    expect(partialAssistantMessage(malformed)).toBeNull();
});

test("the SDK emits provisional text before completion and returns a validated final proposal", async () => {
  const output = {
    message: "Review this suggested time before applying it.",
    proposal: {
      summary: "Start at 10:00",
      operations: [{ type: "set-start-time", stopId: "visit-a", startTime: "10:00" }],
    },
  };
  const raw = JSON.stringify(output);
  let finish: (() => void) | undefined;
  let observed: (() => void) | undefined;
  const firstText = new Promise<void>((resolve) => {
    observed = resolve;
  });
  let sent: Record<string, unknown> = {};
  const provider = createOpenAIProviders({
    apiKey: "synthetic-stream-test-key",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encode.encode(wire(delta(raw.slice(0, 25)))));
            finish = () => {
              controller.enqueue(
                encode.encode(
                  wire(delta(raw.slice(25))) + wire(completed(raw)) + "data: [DONE]\n\n",
                ),
              );
              controller.close();
            };
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      );
    },
  }).conversation;
  const parts: string[] = [];
  let settled = false;
  const pending = provider
    .reply({
      message: "Change the time",
      context,
      preferences: { voice: "marin", style: "concise", memory: false },
      travelPreferences: "private-stored-profile-marker",
      onText: (text) => {
        parts.push(text);
        observed?.();
      },
    })
    .then((reply) => {
      settled = true;
      return reply;
    });
  await firstText;
  expect(settled).toBe(false);
  expect(parts[0]?.length).toBeGreaterThan(0);
  expect(output.message.startsWith(parts[0] ?? "")).toBe(true);
  expect(parts[0]).not.toContain("operations");
  finish?.();
  const reply = await pending;
  expect(sent.stream).toBe(true);
  expect(sent.store).toBe(false);
  expect(sent.max_output_tokens).toBe(1600);
  expect(JSON.stringify(sent)).not.toContain("private-stored-profile-marker");
  expect(reply.message).toBe(output.message);
  expect(reply.proposal).toMatchObject({
    tripId: "known-trip",
    baseVersion: 4,
    operations: output.proposal.operations,
  });
});

test("streamed partials stay cumulative and bounded even with tiny escaped chunks", async () => {
  const text = "\u0001".repeat(4000);
  const raw = JSON.stringify({ message: text, proposal: null });
  const events = (raw.match(/[\s\S]{1,5}/g) ?? []).map(delta);
  const parts: string[] = [];
  const reply = await adapter([...events, completed(raw)]).reply({
    message: "Test fixture",
    onText: (part) => parts.push(part),
  });
  expect(reply.message).toBe(text);
  expect(parts.length).toBeGreaterThan(1);
  expect(parts.length).toBeLessThanOrEqual(64);
  let prior = "";
  for (const part of parts) {
    expect(part.startsWith(prior)).toBe(true);
    prior = part;
  }
  const bytes = encode.encode(
    parts.map((part) => JSON.stringify({ type: "text", text: part })).join("\n") +
      JSON.stringify({ type: "complete", reply }),
  ).byteLength;
  expect(bytes).toBeLessThan(1_000_000);
});

test("failed, incomplete, refused, malformed and foreign-target completions never return an accepted reply", async () => {
  const partial = delta('{"message":"A provisional suggestion');
  const invalidFinals: Event[][] = [
    [partial],
    [
      partial,
      {
        type: "response.failed",
        response: { status: "failed", error: { message: "private-provider-debug-marker" } },
      },
    ],
    [partial, { type: "response.incomplete", response: { status: "incomplete" } }],
    [{ type: "response.refusal.delta", delta: "private-provider-debug-marker" }],
    [completed('{"message":"unfinished')],
    [
      completed(
        JSON.stringify({
          message: "No target",
          proposal: {
            summary: "Foreign visit",
            operations: [{ type: "remove-stop", stopId: "foreign-visit" }],
          },
        }),
      ),
    ],
    [
      delta('{"message":"visible'),
      completed(JSON.stringify({ message: "different final message", proposal: null })),
    ],
  ];
  for (const events of invalidFinals) {
    let failure: unknown;
    try {
      await adapter(events).reply({ message: "Test fixture", context, onText: () => {} });
    } catch (error) {
      failure = error;
    }
    expect(failure).toMatchObject({ code: "INVALID_PROVIDER_RESPONSE" });
    expect(String(failure)).not.toContain("private-provider-debug-marker");
  }
});

test("an abort after a provisional delta rejects completion and cancels the upstream reader", async () => {
  const cancellation = new AbortController();
  let sawPartial: (() => void) | undefined;
  let canceled = false;
  const observed = new Promise<void>((resolve) => {
    sawPartial = resolve;
  });
  const provider = createOpenAIProviders({
    apiKey: "synthetic-stream-test-key",
    fetch: async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(encode.encode(wire(delta('{"message":"Provisional text'))));
          },
          cancel() {
            canceled = true;
          },
        }),
        { headers: { "Content-Type": "text/event-stream" } },
      ),
  }).conversation;
  const parts: string[] = [];
  const pending = provider.reply({
    message: "Test fixture",
    signal: cancellation.signal,
    onText: (part) => {
      parts.push(part);
      sawPartial?.();
    },
  });
  const outcome = pending.then(
    () => null,
    (error: unknown) => error,
  );
  await observed;
  cancellation.abort();
  expect(await outcome).toMatchObject({ code: "PROVIDER_UNAVAILABLE" });
  expect(canceled).toBe(true);
  expect(parts).toEqual(["Provisional text"]);
});
