import { validActivityBudget, validTripCost } from "./costs";
import { validDestination } from "./destinations";
import { validTravelers, validTripDetails } from "./details";
import { validPlaceFacts } from "./facts";
import { DESTINATIONS } from "./fixtures";
import { MAX_TRIP_DAYS } from "./limits";
import { validLodgingIdea } from "./lodging";
import { validMedia } from "./media";
import { validOwnPlace } from "./own-places";
import { validRoute } from "./route";
import { applyTripCommand, undoTripCommand, validateTrip } from "./trip";
import { validTripTitle } from "./trip-title";
import type {
  CommandReceipt,
  CommandResult,
  Place,
  Trip,
  TripOperation,
  TripSnapshot,
} from "./types";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
function integer(value: unknown, minimum = 1): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
function strings(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(text);
}
function time(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
function date(value: unknown): value is string | null {
  return (
    value === null ||
    (typeof value === "string" &&
      /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString().slice(0, 10) === value)
  );
}

function parseBase(value: unknown): Trip | null {
  if (
    !record(value) ||
    !text(value.id) ||
    !integer(value.version) ||
    typeof value.updatedAt !== "string" ||
    !Number.isFinite(Date.parse(value.updatedAt)) ||
    !record(value.brief)
  )
    return null;
  const brief = value.brief;
  const profile = brief.tasteProfile;
  if (brief.originDestination !== undefined && !validDestination(brief.originDestination))
    return null;
  if (
    profile !== undefined &&
    (!record(profile) ||
      !Array.isArray(profile.seeds) ||
      profile.seeds.length > 20 ||
      !profile.seeds.every(
        (seed) => record(seed) && text(seed.id) && text(seed.name) && text(seed.type),
      ) ||
      typeof profile.dayStyle !== "string" ||
      !Array.isArray(profile.categories) ||
      !profile.categories.every((category) =>
        ["cafe", "culture", "food", "outdoors", "shop"].includes(category as string),
      ))
  )
    return null;
  if (
    record(profile) &&
    ((profile.rhythm !== undefined &&
      !["early", "balanced", "late"].includes(profile.rhythm as string)) ||
      (profile.dietary !== undefined &&
        (!strings(profile.dietary) || profile.dietary.length > 12)) ||
      (profile.walking !== undefined &&
        !["short", "moderate", "long"].includes(profile.walking as string)) ||
      (profile.lodging !== undefined && typeof profile.lodging !== "string"))
  )
    return null;
  if (
    !(
      DESTINATIONS.some((item) => item.id === brief.destinationId) ||
      (validDestination(brief.destination) && brief.destination.id === brief.destinationId)
    ) ||
    typeof brief.origin !== "string" ||
    !integer(brief.days) ||
    brief.days > MAX_TRIP_DAYS ||
    !integer(brief.partySize) ||
    brief.partySize > 20 ||
    (brief.budget !== null &&
      (typeof brief.budget !== "number" || !Number.isFinite(brief.budget) || brief.budget < 0)) ||
    typeof brief.currency !== "string" ||
    !/^[A-Z]{3}$/.test(brief.currency) ||
    typeof brief.pace !== "string" ||
    !["slow", "balanced", "full"].includes(brief.pace) ||
    !strings(brief.interests)
  )
    return null;
  if (
    !Array.isArray(value.places) ||
    !Array.isArray(value.days) ||
    !Array.isArray(value.stops) ||
    !strings(value.appliedCommandIds) ||
    new Set(value.appliedCommandIds).size !== value.appliedCommandIds.length
  )
    return null;
  const places: Place[] = [];
  for (const place of value.places) {
    if (
      !record(place) ||
      !text(place.id) ||
      !text(place.name) ||
      typeof place.description !== "string" ||
      typeof place.category !== "string" ||
      !["cafe", "culture", "food", "outdoors", "shop"].includes(place.category) ||
      typeof place.source !== "string" ||
      !["demo", "qloo", "traveler"].includes(place.source) ||
      typeof place.lat !== "number" ||
      !Number.isFinite(place.lat) ||
      Math.abs(place.lat) > 90 ||
      typeof place.lng !== "number" ||
      !Number.isFinite(place.lng) ||
      Math.abs(place.lng) > 180 ||
      !record(place.practical) ||
      place.practical.hours !== "unknown" ||
      place.practical.cost !== "unknown"
    )
      return null;
    if (place.destinationId !== undefined && !text(place.destinationId)) return null;
    if (place.source === "traveler" && !validOwnPlace(place)) return null;
    if (place.facts !== undefined && (place.source !== "qloo" || !validPlaceFacts(place.facts)))
      return null;
    let taste: Place["taste"];
    if (place.source === "qloo") {
      if (
        !record(place.taste) ||
        !text(place.taste.queryId) ||
        !integer(place.taste.rank) ||
        (place.taste.score !== undefined &&
          (typeof place.taste.score !== "number" ||
            !Number.isFinite(place.taste.score) ||
            place.taste.score < 0 ||
            place.taste.score > 1))
      )
        return null;
      taste = {
        queryId: place.taste.queryId,
        rank: place.taste.rank,
        ...(place.taste.score === undefined ? {} : { score: place.taste.score as number }),
      };
    } else if (place.taste !== undefined) return null;
    places.push({
      id: place.id,
      ...(place.destinationId ? { destinationId: place.destinationId as string } : {}),
      name: place.name,
      category: place.category as Place["category"],
      description: place.description,
      lat: place.lat,
      lng: place.lng,
      source: place.source as Place["source"],
      ...(taste ? { taste } : {}),
      practical: { hours: "unknown", cost: "unknown" },
      ...(place.facts ? { facts: structuredClone(place.facts) as Place["facts"] } : {}),
    });
  }
  const days: Trip["days"] = [];
  for (const day of value.days) {
    if (!record(day) || !text(day.id) || !text(day.label) || !date(day.date)) return null;
    if (day.note !== undefined && (typeof day.note !== "string" || day.note.length > 2000))
      return null;
    days.push({
      id: day.id,
      label: day.label,
      date: day.date,
      ...(day.note ? { note: day.note as string } : {}),
    });
  }
  const stops: Trip["stops"] = [];
  for (const stop of value.stops) {
    if (
      !record(stop) ||
      !text(stop.id) ||
      !text(stop.placeId) ||
      !text(stop.dayId) ||
      !time(stop.startTime) ||
      !integer(stop.durationMinutes) ||
      typeof stop.pinned !== "boolean" ||
      typeof stop.timeLocked !== "boolean"
    )
      return null;
    if (stop.feedback !== undefined && !["more", "less"].includes(stop.feedback as string))
      return null;
    if (
      stop.note !== undefined &&
      (typeof stop.note !== "string" || !stop.note.trim() || stop.note.length > 2000)
    )
      return null;
    if (
      stop.selection !== undefined &&
      (!record(stop.selection) ||
        !text(stop.selection.queryId) ||
        !integer(stop.selection.rank) ||
        (stop.selection.score !== undefined &&
          (typeof stop.selection.score !== "number" ||
            !Number.isFinite(stop.selection.score) ||
            stop.selection.score < 0 ||
            stop.selection.score > 1)))
    )
      return null;
    stops.push({
      id: stop.id,
      ...(stop.selection
        ? { selection: structuredClone(stop.selection) as Trip["stops"][number]["selection"] }
        : {}),
      placeId: stop.placeId,
      dayId: stop.dayId,
      startTime: stop.startTime,
      durationMinutes: stop.durationMinutes,
      pinned: stop.pinned,
      timeLocked: stop.timeLocked,
      ...(stop.note !== undefined ? { note: stop.note as string } : {}),
      ...(stop.feedback ? { feedback: stop.feedback as "more" | "less" } : {}),
    });
  }
  if (value.route !== undefined && !validRoute(value.route)) return null;
  if (
    value.lodgings !== undefined &&
    (!Array.isArray(value.lodgings) ||
      !value.lodgings.every(
        (choice) => record(choice) && text(choice.stayId) && validLodgingIdea(choice.candidate),
      ))
  )
    return null;
  if (brief.details !== undefined && !validTripDetails(brief.details, brief.partySize)) return null;
  if (
    value.media !== undefined &&
    (!Array.isArray(value.media) || value.media.length > 50 || !value.media.every(validMedia))
  )
    return null;
  if (
    value.costs !== undefined &&
    (!Array.isArray(value.costs) || value.costs.length > 100 || !value.costs.every(validTripCost))
  )
    return null;
  const trip: Trip = {
    ...(value.media ? { media: structuredClone(value.media) as Trip["media"] } : {}),
    ...(value.title !== undefined ? { title: value.title as string } : {}),
    ...(value.costs !== undefined ? { costs: structuredClone(value.costs) as Trip["costs"] } : {}),
    ...(value.lodgings ? { lodgings: structuredClone(value.lodgings) as Trip["lodgings"] } : {}),
    ...(value.route ? { route: structuredClone(value.route) } : {}),
    id: value.id,
    version: value.version,
    brief: {
      ...(brief.details
        ? { details: structuredClone(brief.details) as Trip["brief"]["details"] }
        : {}),
      destinationId: brief.destinationId as string,
      ...(validDestination(brief.destination)
        ? { destination: structuredClone(brief.destination) }
        : {}),
      origin: brief.origin,
      ...(validDestination(brief.originDestination)
        ? { originDestination: structuredClone(brief.originDestination) }
        : {}),
      days: brief.days,
      partySize: brief.partySize,
      budget: brief.budget as number | null,
      currency: brief.currency,
      pace: brief.pace as Trip["brief"]["pace"],
      interests: [...brief.interests],
      ...(profile
        ? { tasteProfile: structuredClone(profile) as Trip["brief"]["tasteProfile"] }
        : {}),
    },
    places,
    days,
    stops,
    appliedCommandIds: [...value.appliedCommandIds],
    updatedAt: value.updatedAt,
  };
  return validateTrip(trip).length === 0 ? trip : null;
}

function operation(value: unknown): value is TripOperation {
  if (!record(value)) return false;
  if (value.type === "add-media") return validMedia(value.media);
  if (value.type === "remove-media") return text(value.mediaId) && value.mediaId.length <= 80;
  if (value.type === "set-trip-request")
    return typeof value.request === "string" && value.request.length <= 2000;
  if (value.type === "set-travelers") return validTravelers(value.travelers);
  if (value.type === "set-party-size") return integer(value.partySize) && value.partySize <= 20;
  if (value.type === "set-pace")
    return typeof value.pace === "string" && ["slow", "balanced", "full"].includes(value.pace);
  if (value.type === "set-activity-budget")
    return validActivityBudget(value.currency, value.amountMinor);
  if (value.type === "set-own-place") return validOwnPlace(value.place);
  if (value.type === "remove-place-idea") return text(value.placeId);
  if (value.type === "set-stop-note")
    return text(value.stopId) && typeof value.note === "string" && value.note.length <= 2000;
  if (value.type === "set-title")
    return typeof value.title === "string" && validTripTitle(value.title);
  if (value.type === "set-trip-title")
    return (
      typeof value.title === "string" && (!value.title.trim() || validTripTitle(value.title.trim()))
    );
  if (value.type === "set-cost") return validTripCost(value.cost);
  if (value.type === "remove-cost") return text(value.costId);
  if (value.type === "select-lodging")
    return text(value.stayId) && validLodgingIdea(value.candidate);
  if (value.type === "remove-lodging") return text(value.stayId);
  if (value.type === "add-candidates")
    return text(value.destinationId) && Array.isArray(value.places);
  if (value.type === "add-stop")
    return (
      record(value.stop) &&
      text(value.stop.id) &&
      text(value.stop.placeId) &&
      text(value.stop.dayId) &&
      time(value.stop.startTime) &&
      integer(value.stop.durationMinutes) &&
      typeof value.stop.pinned === "boolean" &&
      typeof value.stop.timeLocked === "boolean"
    );
  if (value.type === "annotate-day")
    return text(value.dayId) && text(value.label) && typeof value.note === "string";
  if (value.type === "set-route") return validRoute(value.route);
  if (!text(value.stopId)) return false;
  switch (value.type) {
    case "set-stop-note":
      return typeof value.note === "string" && value.note.length <= 2000;
    case "set-duration":
      return integer(value.durationMinutes);
    case "rate-stop":
      return value.feedback === null || value.feedback === "more" || value.feedback === "less";
    case "pin-stop":
      return typeof value.pinned === "boolean";
    case "lock-time":
      return typeof value.timeLocked === "boolean";
    case "remove-stop":
      return true;
    case "move-stop":
      return text(value.dayId) && time(value.startTime);
    case "replace-stop":
      return text(value.placeId);
    case "set-start-time":
      return time(value.startTime);
    default:
      return false;
  }
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (record(value))
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "undefined";
}
function sameState(left: TripSnapshot, right: TripSnapshot): boolean {
  const { commandLog: _leftLog, updatedAt: _leftTime, ...leftState } = left as Trip;
  const { commandLog: _rightLog, updatedAt: _rightTime, ...rightState } = right as Trip;
  return canonical(leftState) === canonical(rightState);
}

/** Corruption detection for local persistence, not server authorization or a signature. */
export function parseStoredTrip(value: unknown): Trip | null {
  try {
    const trip = parseBase(value);
    if (!trip || !record(value)) return null;
    if (value.commandLog === undefined) return trip;
    if (!Array.isArray(value.commandLog)) return null;
    const log: CommandReceipt[] = [];
    let previousResult: Trip | null = null;
    for (const entry of value.commandLog) {
      if (
        !record(entry) ||
        !text(entry.commandId) ||
        !text(entry.fingerprint) ||
        !integer(entry.beforeVersion) ||
        entry.afterVersion !== entry.beforeVersion + 1 ||
        !strings(entry.affectedStopIds) ||
        new Set(entry.affectedStopIds).size !== entry.affectedStopIds.length ||
        !record(entry.before) ||
        "commandLog" in entry.before
      )
        return null;
      const before = parseBase(entry.before);
      if (
        !before ||
        before.id !== trip.id ||
        before.version !== entry.beforeVersion ||
        !trip.appliedCommandIds.includes(entry.commandId) ||
        log.some((item) => item.commandId === entry.commandId) ||
        (previousResult && !sameState(previousResult, before))
      )
        return null;
      const payload: unknown = JSON.parse(entry.fingerprint);
      if (!record(payload)) return null;
      const state = { ...before, commandLog: log };
      let result: CommandResult;
      if (
        integer(payload.baseVersion) &&
        Array.isArray(payload.operations) &&
        payload.operations.length > 0 &&
        payload.operations.every(operation)
      ) {
        result = applyTripCommand(state, {
          id: entry.commandId,
          baseVersion: payload.baseVersion,
          operations: payload.operations,
        });
      } else if (text(payload.undoOf) && integer(payload.afterVersion)) {
        const target = log.find(
          (item) => item.commandId === payload.undoOf && item.afterVersion === payload.afterVersion,
        );
        if (!target) return null;
        result = undoTripCommand(state, target, entry.commandId);
      } else return null;
      if (
        !result.ok ||
        result.replayed ||
        result.receipt.fingerprint !== entry.fingerprint ||
        result.receipt.beforeVersion !== entry.beforeVersion ||
        result.receipt.afterVersion !== entry.afterVersion ||
        canonical(result.receipt.affectedStopIds) !== canonical(entry.affectedStopIds)
      )
        return null;
      const receipt: CommandReceipt = {
        commandId: entry.commandId,
        fingerprint: entry.fingerprint,
        beforeVersion: entry.beforeVersion,
        afterVersion: entry.afterVersion as number,
        before,
        affectedStopIds: [...entry.affectedStopIds],
      };
      log.push(receipt);
      previousResult = result.trip;
    }
    if (previousResult && !sameState(previousResult, trip)) return null;
    trip.commandLog = log;
    return trip;
  } catch {
    return null;
  }
}
