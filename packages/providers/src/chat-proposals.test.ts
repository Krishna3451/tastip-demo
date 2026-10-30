import { describe, expect, test } from "bun:test";
import { localEditReply, parseConversationOutput, proposalTargetsKnown } from "./chat-proposals";
import type { TripContext } from "./contracts";

const context: TripContext = {
  tripId: "trip-one",
  version: 4,
  destinationId: "lisbon",
  days: 2,
  partySize: 2,
  interests: [],
  calendar: [
    { id: "day-1", date: null, city: "Lisbon", timeZone: "Europe/Lisbon" },
    { id: "day-2", date: null, city: "Lisbon", timeZone: "Europe/Lisbon" },
  ],
  places: [
    { id: "place-a", name: "Quiet Café" },
    { id: "place-b", name: "Art House" },
  ],
  stops: [
    {
      id: "visit-a",
      placeId: "place-a",
      name: "Quiet Café",
      day: "day-1",
      time: "09:30",
      pinned: false,
      timeLocked: false,
      sample: true,
    },
  ],
};

describe("reviewed conversation edits", () => {
  test("structured reply binds exact known visits to the accepted trip/version", () => {
    const output = parseConversationOutput(
      {
        message: "Here is a suggested time change.",
        proposal: {
          summary: "Start Quiet Café at 10:00.",
          operations: [{ type: "set-start-time", stopId: "visit-a", startTime: "10:00" }],
        },
      },
      context,
    );
    expect(output.proposal).toMatchObject({
      tripId: "trip-one",
      baseVersion: 4,
      operations: [{ type: "set-start-time", stopId: "visit-a", startTime: "10:00" }],
    });
    expect(output.proposal?.id).toBeString();
    expect(output.provider).toBe("openai");
    expect(context.version).toBe(4);
  });

  test("rejects invented targets, place/visit identity confusion, unsupported operations and malformed times", () => {
    const output = (operation: unknown) => ({
      message: "Suggestion",
      proposal: { summary: "Change", operations: [operation] },
    });
    expect(() =>
      parseConversationOutput(output({ type: "remove-stop", stopId: "place-a" }), context),
    ).toThrow("invalid change proposal");
    expect(() =>
      parseConversationOutput(
        output({ type: "move-stop", stopId: "visit-a", dayId: "missing", startTime: "10:00" }),
        context,
      ),
    ).toThrow();
    expect(() =>
      parseConversationOutput(
        output({ type: "replace-stop", stopId: "visit-a", placeId: "invented" }),
        context,
      ),
    ).toThrow();
    expect(() =>
      parseConversationOutput(
        output({ type: "set-start-time", stopId: "visit-a", startTime: "25:00" }),
        context,
      ),
    ).toThrow();
    expect(() =>
      parseConversationOutput(output({ type: "book-hotel", placeId: "place-a" }), context),
    ).toThrow();
    expect(() =>
      parseConversationOutput(
        output({ type: "remove-stop", stopId: "visit-a", secretExtra: true }),
        context,
      ),
    ).toThrow();
    expect(
      proposalTargetsKnown([{ type: "remove-stop", stopId: "visit-a" }], {
        ...context,
        tripId: undefined,
      }),
    ).toBe(false);
  });

  test("advice needs no proposal or existing trip", () => {
    expect(
      parseConversationOutput({ message: "Which city do you have in mind?", proposal: null }),
    ).toEqual({ message: "Which city do you have in mind?", provider: "openai" });
  });

  test("exact local edits are labeled and proposed without mutating the trip", () => {
    const pinned = localEditReply("Pin Quiet Café", context);
    expect(pinned?.provider).toBe("local");
    expect(pinned?.proposal?.operations).toEqual([
      { type: "pin-stop", stopId: "visit-a", pinned: true },
    ]);
    expect(localEditReply("Unpin Quiet Café", context)?.proposal?.operations).toEqual([
      { type: "pin-stop", stopId: "visit-a", pinned: false },
    ]);
    expect(localEditReply("Remove Quiet Café", context)?.proposal?.operations).toEqual([
      { type: "remove-stop", stopId: "visit-a" },
    ]);
    expect(context.stops[0]?.pinned).toBe(false);
  });

  test("local times handle 12-hour conversion and exact known day identities", () => {
    expect(
      localEditReply("Move Quiet Café to day 2 at 2:30 pm", context)?.proposal?.operations,
    ).toEqual([{ type: "move-stop", stopId: "visit-a", dayId: "day-2", startTime: "14:30" }]);
    expect(localEditReply("Start Quiet Café at 12am", context)?.proposal?.operations).toEqual([
      { type: "set-start-time", stopId: "visit-a", startTime: "00:00" },
    ]);
    expect(localEditReply("Make Quiet Café to 10:00", context)?.proposal?.baseVersion).toBe(4);
  });

  test("ambiguous/negative/compound commands and non-trip questions do not trigger local edits", () => {
    expect(localEditReply("Remove Quiet Café but don't actually remove it", context)).toBeNull();
    expect(localEditReply("Move Quiet Café somewhere at 10:00", context)).toBeNull();
    expect(localEditReply("Move Quiet Café to day 9 at 10:00", context)).toBeNull();
    expect(localEditReply("Move Quiet Café at 13pm", context)).toBeNull();
    expect(localEditReply("Move Quiet Café at 24:00", context)).toBeNull();
    expect(
      localEditReply("Pin Quiet Café", {
        ...context,
        stops: [...context.stops, { ...context.stops[0]!, id: "visit-again" }],
      }),
    ).toBeNull();
    expect(localEditReply("What is Kyoto like?", context)).toBeNull();
    expect(localEditReply("Pin Quiet Café")).toBeNull();
  });
});

test("OpenAI adapter requests strict structured output and validates actual response text", async () => {
  const { createOpenAIProviders } = await import("./openai");
  let sent: Record<string, unknown> | undefined;
  const providers = createOpenAIProviders({
    apiKey: "synthetic-contract-key",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({
        id: "resp_contract",
        object: "response",
        output: [
          {
            type: "message",
            id: "message_contract",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({
                  message: "Review the suggested time.",
                  proposal: {
                    summary: "Start at 10:00.",
                    operations: [{ type: "set-start-time", stopId: "visit-a", startTime: "10:00" }],
                  },
                }),
                annotations: [],
              },
            ],
          },
        ],
      });
    },
  });
  const reply = await providers.conversation.reply({
    message: "Start Quiet Café at 10:00",
    context,
  });
  expect(sent?.store).toBe(false);
  expect(JSON.stringify(sent?.text)).not.toContain("oneOf");
  expect(sent?.text).toMatchObject({
    format: { type: "json_schema", name: "tastip_conversation_reply", strict: true },
  });
  expect(String(sent?.instructions)).toContain("visit-a");
  expect(reply.proposal?.operations).toEqual([
    { type: "set-start-time", stopId: "visit-a", startTime: "10:00" },
  ]);
  expect(reply.proposal?.baseVersion).toBe(4);
});
