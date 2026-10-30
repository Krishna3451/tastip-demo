import type { TripOperation } from "@tastip/domain";
import { z } from "zod";
import { type ConversationReply, ProviderError, type TripContext } from "./contracts";

const id = z.string().min(1).max(100);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** Only scoped visit edits are available to conversation; provider data and routes have separate flows. */
export const chatOperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set-duration"),
      stopId: id,
      durationMinutes: z.number().int().min(1).max(1440),
    })
    .strict(),
  z.object({ type: z.literal("set-start-time"), stopId: id, startTime: time }).strict(),
  z.object({ type: z.literal("move-stop"), stopId: id, dayId: id, startTime: time }).strict(),
  z.object({ type: z.literal("pin-stop"), stopId: id, pinned: z.boolean() }).strict(),
  z.object({ type: z.literal("lock-time"), stopId: id, timeLocked: z.boolean() }).strict(),
  z.object({ type: z.literal("remove-stop"), stopId: id }).strict(),
  z.object({ type: z.literal("replace-stop"), stopId: id, placeId: id }).strict(),
  z
    .object({
      type: z.literal("rate-stop"),
      stopId: id,
      feedback: z.enum(["more", "less"]).nullable(),
    })
    .strict(),
]);
export const conversationOutputSchema = z
  .object({
    message: z.string().min(1).max(4000),
    proposal: z
      .object({
        summary: z.string().min(1).max(500),
        operations: z.array(chatOperationSchema).min(1).max(8),
      })
      .strict()
      .nullable(),
  })
  .strict();

export function modelJsonSchema(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(modelJsonSchema);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "$schema")
        .map(([key, item]) => [key === "oneOf" ? "anyOf" : key, modelJsonSchema(item)]),
    );
  return value;
}
// Zod emits oneOf for discriminated unions; Responses structured output accepts anyOf.
// Each branch has a distinct literal type, so these schemas retain equivalent validation.
export const conversationOutputJsonSchema = modelJsonSchema(
  z.toJSONSchema(conversationOutputSchema, { target: "draft-7" }),
) as Record<string, unknown>;

export function proposalTargetsKnown(operations: TripOperation[], context?: TripContext): boolean {
  if (!context?.tripId || !context.version || !context.calendar?.length) return false;
  const stops = new Set(context.stops.flatMap((stop) => (stop.id ? [stop.id] : [])));
  const days = new Set(context.calendar.flatMap((day) => (day.id ? [day.id] : [])));
  const places = new Set(context.places?.map((place) => place.id));
  return operations.every((operation) => {
    if (!("stopId" in operation) || !stops.has(operation.stopId)) return false;
    if (operation.type === "move-stop" && !days.has(operation.dayId)) return false;
    if (operation.type === "replace-stop" && !places.has(operation.placeId)) return false;
    return true;
  });
}

/** Reject malformed/foreign-target edits before offering a review; domain invariants run again on Apply. */
export function parseConversationOutput(value: unknown, context?: TripContext): ConversationReply {
  const result = conversationOutputSchema.safeParse(value);
  if (
    !result.success ||
    (result.data.proposal && !proposalTargetsKnown(result.data.proposal.operations, context))
  )
    throw new ProviderError(
      "INVALID_PROVIDER_RESPONSE",
      "The assistant returned an invalid change proposal. Your itinerary is unchanged; please try a more specific request.",
    );
  return {
    message: result.data.message,
    provider: "openai",
    ...(result.data.proposal && context?.version && context.tripId
      ? {
          proposal: {
            id: crypto.randomUUID(),
            tripId: context.tripId,
            baseVersion: context.version,
            summary: result.data.proposal.summary,
            operations: result.data.proposal.operations,
          },
        }
      : {}),
  };
}

/** Small, explicit grammar for offline edits. This is a local command parser, never simulated GPT. */
export function localEditReply(message: string, context?: TripContext): ConversationReply | null {
  if (!context?.tripId || !context.version) return null;
  const text = message.trim();
  const candidates = context.stops.filter(
    (stop) =>
      stop.id && stop.name && text.toLocaleLowerCase().includes(stop.name.toLocaleLowerCase()),
  );
  if (candidates.length !== 1) return null;
  const stop = candidates[0];
  if (!stop?.id) return null;
  let operation: TripOperation | undefined;
  let summary = "";
  const lower = text.toLocaleLowerCase();
  const target = stop.name.toLocaleLowerCase();
  const direct = (verb: string) => lower === `${verb} ${target}` || lower === `${verb} ${target}.`;
  if (direct("unpin")) {
    operation = { type: "pin-stop", stopId: stop.id, pinned: false };
    summary = `Unpin ${stop.name}.`;
  } else if (direct("pin")) {
    operation = { type: "pin-stop", stopId: stop.id, pinned: true };
    summary = `Keep ${stop.name} in the plan.`;
  } else if (direct("remove") || direct("delete")) {
    operation = { type: "remove-stop", stopId: stop.id };
    summary = `Remove the visit to ${stop.name}.`;
  } else if (/^(move|make|start|set)\b/.test(lower)) {
    const verb = lower.match(/^(move|make|start|set)\s+/)?.[0];
    if (!verb || !lower.startsWith(`${verb}${target} `)) return null;
    const rest = text.slice(verb.length + stop.name.length).trim();
    const match = rest.match(
      /^(?:(?:to\s+)?day\s+(\d+)\s+)?(?:at|to)\s+(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?\s*\.?$/i,
    );
    if (!match) return null;
    let hour = Number(match[2]);
    const minute = match[3] ?? "00";
    const period = match[4]?.toLowerCase();
    if (period && (hour < 1 || hour > 12)) return null;
    if (period) hour = (hour % 12) + (period === "pm" ? 12 : 0);
    if (hour > 23) return null;
    const startTime = `${String(hour).padStart(2, "0")}:${minute}`;
    if (match[1]) {
      const day = context.calendar?.[Number(match[1]) - 1];
      if (!day?.id) return null;
      operation = { type: "move-stop", stopId: stop.id, dayId: day.id, startTime };
      summary = `Move ${stop.name} to Day ${match[1]} at ${startTime}.`;
    } else {
      operation = { type: "set-start-time", stopId: stop.id, startTime };
      summary = `Start ${stop.name} at ${startTime}.`;
    }
  }
  if (!operation || !proposalTargetsKnown([operation], context)) return null;
  return {
    message:
      "I understood this as a local itinerary command. Review the change before applying it.",
    provider: "local",
    proposal: {
      id: crypto.randomUUID(),
      tripId: context.tripId,
      baseVersion: context.version,
      summary,
      operations: [operation],
    },
  };
}
