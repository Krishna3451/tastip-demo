import { applyTripCommand, type Trip } from "@tastip/domain";
import { z } from "zod";
import { chatOperationSchema, modelJsonSchema } from "./chat-proposals";
import type { ChatProposal } from "./contracts";

export const VOICE_REVIEW_TOOL_NAME = "propose_itinerary_edit";
const argumentsSchema = z
  .object({
    tripId: z.string().min(1).max(150),
    baseVersion: z.number().int().positive(),
    summary: z.string().min(1).max(500),
    operations: z.array(chatOperationSchema).min(1).max(8),
  })
  .strict();

export const voiceReviewTool = {
  type: "function" as const,
  name: VOICE_REVIEW_TOOL_NAME,
  description:
    "Propose a scoped change to known itinerary visits. Use the exact accepted tripId, version and visit IDs. The traveler must review and Apply the proposal on screen; this tool never commits an edit. Do not call for advice or an ambiguous target.",
  parameters: modelJsonSchema(z.toJSONSchema(argumentsSchema, { target: "draft-7" })),
};

type ReviewResult = {
  callId: string;
  proposal?: ChatProposal;
  output: { status: "pending_review" | "rejected"; message: string; proposalId?: string };
};
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** A voice connection proposes validated edits, with one review per completed tool call. */
export class VoiceReviewSession {
  private readonly seen = new Set<string>();

  accept(event: unknown, trip?: Trip): ReviewResult[] {
    if (
      !record(event) ||
      event.type !== "response.done" ||
      !record(event.response) ||
      !Array.isArray(event.response.output)
    )
      return [];
    const results: ReviewResult[] = [];
    for (const item of event.response.output.slice(0, 8)) {
      if (
        !record(item) ||
        item.type !== "function_call" ||
        typeof item.call_id !== "string" ||
        !/^[A-Za-z0-9_-]{1,150}$/.test(item.call_id) ||
        this.seen.has(item.call_id)
      )
        continue;
      if (event.response.status !== "completed") {
        if (this.seen.size < 256) this.seen.add(item.call_id);
        continue;
      }
      if (this.seen.size >= 256) {
        results.push({
          callId: item.call_id,
          output: {
            status: "rejected",
            message: "Start a new call or continue in text to review more changes.",
          },
        });
        continue;
      }
      this.seen.add(item.call_id);
      let proposal: ChatProposal | undefined;
      let reason = "This voice suggestion could not be validated. Your itinerary is unchanged.";
      if (
        trip &&
        item.name === VOICE_REVIEW_TOOL_NAME &&
        typeof item.arguments === "string" &&
        item.arguments.length <= 32_768
      ) {
        try {
          const parsed = argumentsSchema.safeParse(JSON.parse(item.arguments));
          if (parsed.success) {
            if (parsed.data.tripId !== trip.id || parsed.data.baseVersion !== trip.version)
              reason =
                "Your plan changed while this suggestion was being prepared. Ask again using the current trip.";
            else {
              const candidate = { id: `voice:${item.call_id}`, ...parsed.data };
              const preview = applyTripCommand(trip, {
                id: candidate.id,
                baseVersion: candidate.baseVersion,
                operations: candidate.operations,
              });
              if (preview.ok) proposal = candidate;
              else reason = preview.error.message;
            }
          }
        } catch {
          /* Invalid tool arguments never reach the accepted trip. */
        }
      } else if (!trip) reason = "Open a trip before asking for an itinerary change.";
      results.push(
        proposal
          ? {
              callId: item.call_id,
              proposal,
              output: {
                status: "pending_review",
                proposalId: proposal.id,
                message:
                  "The change is on screen for review. Nothing has changed; the traveler must choose Apply change.",
              },
            }
          : { callId: item.call_id, output: { status: "rejected", message: reason } },
      );
    }
    return results;
  }
}
