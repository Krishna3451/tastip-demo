import { describe, expect, test } from "bun:test";
import { applyTripCommand, createDemoTrip, DEFAULT_BRIEF, type Trip } from "@tastip/domain";
import { createOpenAIProviders } from "./openai";
import { VOICE_REVIEW_TOOL_NAME, VoiceReviewSession } from "./voice-tools";

function completion(trip: Trip, overrides: Record<string, unknown> = {}, callId = "call_review") {
  return {
    type: "response.done",
    response: {
      status: "completed",
      output: [
        {
          type: "function_call",
          name: VOICE_REVIEW_TOOL_NAME,
          call_id: callId,
          arguments: JSON.stringify({
            tripId: trip.id,
            baseVersion: trip.version,
            summary: "Start the first visit at 10:00.",
            operations: [{ type: "set-start-time", stopId: trip.stops[0]?.id, startTime: "10:00" }],
            ...overrides,
          }),
        },
      ],
    },
  };
}

describe("voice proposals use canonical review commands", () => {
  test("valid spoken intent leaves the trip unchanged until the same proposal is explicitly applied", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const before = structuredClone(trip);
    const review = new VoiceReviewSession().accept(completion(trip), trip)[0];
    expect(trip).toEqual(before);
    expect(review?.output.status).toBe("pending_review");
    expect(review?.proposal?.baseVersion).toBe(trip.version);
    const proposal = review?.proposal;
    if (!proposal) throw new Error("Expected a reviewable voice proposal");
    const accepted = applyTripCommand(trip, {
      id: proposal.id,
      baseVersion: proposal.baseVersion,
      operations: proposal.operations,
    });
    expect(accepted.ok).toBe(true);
    if (accepted.ok) expect(accepted.trip.stops[0]?.startTime).toBe("10:00");
  });

  test("stale or foreign trip versions never produce a review card", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    for (const overrides of [{ tripId: "another-trip" }, { baseVersion: trip.version + 1 }]) {
      const reply = new VoiceReviewSession().accept(completion(trip, overrides), trip)[0];
      expect(reply?.proposal).toBeUndefined();
      expect(reply?.output.status).toBe("rejected");
      expect(reply?.output.message).toContain("plan changed");
    }
  });

  test("unknown visits, overlaps, locked times and unsupported operations respect domain constraints", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const invalid = [
      [{ type: "remove-stop", stopId: "foreign-visit" }],
      [{ type: "set-start-time", stopId: trip.stops[0]?.id, startTime: "12:30" }],
      [{ type: "book-hotel", stopId: trip.stops[0]?.id }],
    ];
    for (const operations of invalid)
      expect(
        new VoiceReviewSession().accept(completion(trip, { operations }), trip)[0]?.output.status,
      ).toBe("rejected");
    const locked = structuredClone(trip);
    if (locked.stops[0]) locked.stops[0].timeLocked = true;
    expect(new VoiceReviewSession().accept(completion(locked), locked)[0]?.output.status).toBe(
      "rejected",
    );
  });

  test("cancelled calls and repeated completion packets cannot add duplicate proposals", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const session = new VoiceReviewSession();
    const cancelled = completion(trip);
    cancelled.response.status = "cancelled";
    expect(session.accept(cancelled, trip)).toEqual([]);
    expect(session.accept(completion(trip), trip)).toEqual([]);
    const next = completion(trip, {}, "call_next");
    expect(session.accept(next, trip)[0]?.output.status).toBe("pending_review");
    expect(session.accept(next, trip)).toEqual([]);
  });

  test("malformed arguments and entry-screen calls fail without exposing their input", () => {
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const event = completion(trip);
    if (event.response.output[0]) event.response.output[0].arguments = "private malformed input";
    const reply = new VoiceReviewSession().accept(event, trip)[0];
    expect(reply?.output.status).toBe("rejected");
    expect(JSON.stringify(reply)).not.toContain("private malformed input");
    expect(new VoiceReviewSession().accept(completion(trip))[0]?.output.status).toBe("rejected");
  });

  test("the actual SDK session request advertises only reviewable edits and returns an ephemeral credential", async () => {
    let requestBody: Record<string, unknown> = {};
    const providers = createOpenAIProviders({
      apiKey: "synthetic-server-key",
      fetch: async (_input, init) => {
        requestBody = JSON.parse(String(init?.body));
        return Response.json({ value: "synthetic-ephemeral-key", expires_at: 123456 });
      },
    });
    const session = await providers.voice.createSession();
    const configuration = requestBody.session as {
      tools: { name: string }[];
      instructions: string;
    };
    expect(configuration.tools.map((tool) => tool.name)).toEqual([VOICE_REVIEW_TOOL_NAME]);
    expect(configuration.instructions).toContain("pending_review");
    expect(session.clientSecret).toBe("synthetic-ephemeral-key");
    expect(JSON.stringify(session)).not.toContain("synthetic-server-key");
  });
});
