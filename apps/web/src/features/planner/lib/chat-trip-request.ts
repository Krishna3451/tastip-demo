import { parseTripRequest } from "@tastip/domain";

type ChatTurn = { role: "user" | "assistant"; text: string };

const tripObject = "(?:[\\p{L}\\d'’-]+\\s+){0,6}(?:trip|itinerary|vacation|holiday|journey)\\b";
const creation = new RegExp(
  `\\b(?:plan|create|build|start|draft|design|organize|make|put together)\\s+${tripObject}`,
  "giu",
);
const personalTrip = new RegExp(
  `\\b(?:(?:i|we)(?:'d| would)? (?:like|want)|(?:i'm|we're|i am|we are) thinking (?:about|of))\\s+${tripObject}`,
  "giu",
);
const readOnly =
  /\b(?:summari[sz]e|summary|explain|describe|review|compare|check|verify|remind|tell|show|what|why|how|when|where|which|is|are|does|weather|hours|pack|wear|bring)\b|\b(?:existing|current)\s+(?:trip|itinerary|plan|route)\b|\?/i;

function negatedBefore(text: string, index: number) {
  return /\b(?:don't|do not|not|never|no|without|avoid|rather than|instead of)(?:\s+[\p{L}'’-]+){0,4}\s*$/iu.test(
    text.slice(0, index),
  );
}

function informationalPrefix(prefix: string) {
  return /(?:\b(?:explain|summari[sz]e|describe)\b.*|\bhow\s+(?:to|do i|can i)\b.*)$/i.test(prefix);
}

function requestsCreation(text: string): "create" | "new" | null {
  let creationRequested = false;
  // Scope a negative to its clause: "don't change this trip; plan the next trip"
  // still contains an affirmative creation request.
  for (const clause of text.split(
    /(?<=[.!?;\n])|\b(?:but|then)\b|,\s*(?:and|also)\s+|\band\s+(?=(?:please\s+)?(?:plan|create|build|start|draft|design|organize|make)\b)/i,
  )) {
    let clauseCreationRequested = false;
    for (const pattern of [creation, personalTrip]) {
      for (const match of clause.matchAll(pattern)) {
        const index = match.index ?? 0;
        const prefix = clause.slice(0, index);
        if (
          negatedBefore(clause, index) ||
          /\b(?:summary|explanation|overview|description|meaning|of|for)\b/i.test(match[0]) ||
          informationalPrefix(prefix)
        )
          continue;
        creationRequested = true;
        clauseCreationRequested = true;
      }
    }
    for (const match of clause.matchAll(
      /\b(?:new|next|another)\s+(?:trip|itinerary|vacation|holiday)\b/gi,
    )) {
      const index = match.index ?? 0;
      // "Next trip" can name the trip a packing/date question is about.
      // An affirmative planning request may itself be phrased as a question.
      if (
        !negatedBefore(clause, index) &&
        !informationalPrefix(clause.slice(0, index)) &&
        (clauseCreationRequested || !readOnly.test(clause))
      )
        return "new";
    }
  }
  return creationRequested ? "create" : null;
}

function unboundRouteStarter(text: string) {
  if (readOnly.test(text)) return false;
  // Only cities + an explicit duration matter here; no parsed dates are used.
  const { cityQueries, days } = parseTripRequest(text, "2000-01-01");
  return (
    days !== null &&
    days > 0 &&
    cityQueries.length > 0 &&
    cityQueries.every((city) => /^[\p{L}][\p{L} .’'–-]{0,79}$/u.test(city))
  );
}

/** Creation is an explicit user intent, never an inference from the assistant reply.
 * Bound-trip questions cannot create a new trip implicitly. Keep clarifications
 * after a planning request, but a read-only turn cancels that old handoff intent.
 */
export function chatTripCreationRequest(messages: ChatTurn[], hasTrip: boolean): string {
  let start = -1;
  for (const [index, message] of messages.entries()) {
    if (message.role !== "user") continue;
    const text = message.text.trim().replaceAll("’", "'");
    if (!text) continue;
    const intent = requestsCreation(text);
    if (intent || (!hasTrip && unboundRouteStarter(text))) {
      if (start < 0 || intent === "new") start = index;
    } else if (
      readOnly.test(text) ||
      /\b(?:don't|do not|not|never|no|without|avoid)\b.*\b(?:create|build|plan|start|trip|itinerary|change|edit|modify)\b/i.test(
        text,
      )
    )
      start = -1;
  }
  return start < 0 ? "" : chatTripRequest(messages.slice(start));
}

/** Keep the original request and newest user clarifications, without copying assistant claims. */
export function chatTripRequest(messages: ChatTurn[]): string {
  const turns = messages
    .filter((message) => message.role === "user")
    .map((message) => message.text.trim())
    .filter(Boolean);
  const initial = turns[0];
  if (!initial) return "";
  if (turns.length === 1) return initial.slice(0, 2000);
  // Reserve room for recent clarifications even when the original request is very long.
  const first = initial.slice(0, 1500);
  const recent: string[] = [];
  let remaining = 2000 - first.length;
  for (let index = turns.length - 1; index > 0 && remaining > 1; index--) {
    const turn = turns[index];
    if (!turn) continue;
    const kept = turn.slice(0, remaining - 1);
    recent.unshift(kept);
    remaining -= kept.length + 1;
  }
  return [first, ...recent].join("\n");
}

function latestNumber(text: string, pattern: RegExp): number | undefined {
  let latest: number | undefined;
  for (const match of text.matchAll(pattern)) latest = Number(match[1]);
  return latest;
}

/** Clarifications change only explicitly numbered scalars; Where/When pickers remain authoritative. */
export function parseChatTripRequest(
  prompt: string,
  today: string,
): ReturnType<typeof parseTripRequest> {
  const lines = prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length <= 1) return parseTripRequest(prompt, today);
  const parsed = parseTripRequest(lines[0] ?? "", today);
  const counts = { ...parsed.counts };
  let days = parsed.days;
  for (const line of lines.slice(1)) {
    const duration = latestNumber(line, /\b(\d+)\s*[-– ]?\s*days?\b/gi);
    if (duration !== undefined) days = duration;
    const patterns = {
      adults: /\b(\d+)\s*adults?\b/gi,
      children: /\b(\d+)\s*(?:children|kids|child)\b/gi,
      infants: /\b(\d+)\s*(?:infants?|babies|baby)\b/gi,
      pets: /\b(\d+)\s*(?:pets?|dogs?|cats?)\b/gi,
    };
    for (const key of Object.keys(patterns) as (keyof typeof counts)[]) {
      const value = latestNumber(line, patterns[key]);
      if (value !== undefined) counts[key] = value;
    }
  }
  return { ...parsed, days, counts };
}
