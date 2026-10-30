import { COST_CURRENCIES, validActivityBudget, validTripCost } from "./costs";
import { getTripDestination } from "./destinations";
import { validTravelers, validTripDetails } from "./details";
import { validPlaceFacts } from "./facts";
import { createTripFromPlaces } from "./fixtures";
import { MAX_TRIP_DAYS } from "./limits";
import { validLodgingIdea } from "./lodging";
import { validMedia } from "./media";
import { MAX_OWN_PLACE_DISTANCE_KM, ownPlaceNearCity, validOwnPlace } from "./own-places";
import {
  destinationForDay,
  routeDayDate,
  routeStayDates,
  validRoute,
  visitTravelIssue,
} from "./route";
import { validTripTitle } from "./trip-title";
import type {
  CommandReceipt,
  CommandResult,
  DomainIssue,
  Trip,
  TripCommand,
  TripSnapshot,
  TripStop,
} from "./types";

function minutes(time: string): number | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function snapshot(trip: Trip): TripSnapshot {
  const { commandLog: _commandLog, ...state } = trip;
  return structuredClone(state);
}

function fingerprint(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(fingerprint).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${fingerprint(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function failure(code: string, message: string, stopId?: string): CommandResult {
  return { ok: false, error: { code, message, ...(stopId ? { stopId } : {}) } };
}

function replay(trip: Trip, commandId: string, signature: string): CommandResult | null {
  const receipt = trip.commandLog?.find((item) => item.commandId === commandId);
  if (receipt) {
    if (receipt.fingerprint !== signature)
      return failure("COMMAND_ID_REUSED", "This command ID was already used for a different edit.");
    // Return the original acknowledgement without rolling back later accepted edits.
    return { ok: true, trip, receipt: structuredClone(receipt), replayed: true };
  }
  if (trip.appliedCommandIds.includes(commandId))
    return failure(
      "COMMAND_RESULT_UNAVAILABLE",
      "This edit was already applied, but its receipt is unavailable. It will not be applied twice.",
    );
  return null;
}

export function getDayStops(trip: Trip, dayId: string): TripStop[] {
  return trip.stops
    .filter((stop) => stop.dayId === dayId)
    .sort(
      (left, right) =>
        left.startTime.localeCompare(right.startTime) || left.id.localeCompare(right.id),
    );
}

/** Validates schedule consistency and entered transfer windows, not real-world feasibility. */
export function validateTrip(trip: Trip): DomainIssue[] {
  const issues: DomainIssue[] = [];
  if (
    trip.media !== undefined &&
    (!Array.isArray(trip.media) ||
      trip.media.length > 50 ||
      !trip.media.every(validMedia) ||
      new Set(trip.media.map((item) => item.id)).size !== trip.media.length)
  )
    issues.push({
      code: "INVALID_MEDIA",
      message: "Keep up to 50 valid private files or links per trip.",
    });
  if (
    trip.brief.details !== undefined &&
    !validTripDetails(trip.brief.details, trip.brief.partySize)
  )
    issues.push({ code: "INVALID_DETAILS", message: "Check your trip brief and traveler counts." });
  if (trip.title !== undefined && !validTripTitle(trip.title))
    issues.push({
      code: "INVALID_TITLE",
      message: "Use a trip name of up to 120 characters on one line.",
    });
  const unique = (items: { id: string }[], label: string) => {
    const ids = new Set<string>();
    for (const item of items) {
      if (!item.id || ids.has(item.id))
        issues.push({ code: "DUPLICATE_ID", message: `${label} IDs must be present and unique.` });
      ids.add(item.id);
    }
    return ids;
  };
  if (!Number.isInteger(trip.version) || trip.version < 1)
    issues.push({ code: "INVALID_VERSION", message: "Trip version must be a positive integer." });
  if (
    !Number.isInteger(trip.brief.days) ||
    trip.brief.days < 1 ||
    trip.brief.days > MAX_TRIP_DAYS ||
    trip.days.length !== trip.brief.days
  )
    issues.push({ code: "INVALID_DAYS", message: "The day list must match the trip length." });
  if (
    !Number.isInteger(trip.brief.partySize) ||
    trip.brief.partySize < 1 ||
    trip.brief.partySize > 20
  )
    issues.push({ code: "INVALID_PARTY", message: "Choose between 1 and 20 travelers." });
  if (trip.brief.budget !== null && (!Number.isFinite(trip.brief.budget) || trip.brief.budget < 0))
    issues.push({ code: "INVALID_BUDGET", message: "Budget must be nonnegative or unknown." });
  const dayIds = unique(trip.days, "Day");
  if (trip.costs !== undefined) {
    if (!Array.isArray(trip.costs) || trip.costs.length > 100 || !trip.costs.every(validTripCost))
      issues.push({
        code: "INVALID_COST",
        message: "Record up to 100 valid planned costs, with a supported currency and quantity.",
      });
    else unique(trip.costs, "Planned cost");
  }
  if (trip.route) {
    if (
      !validRoute(trip.route) ||
      trip.route.stays.reduce((sum, stay) => sum + stay.days, 0) !== trip.days.length ||
      trip.route.stays[0]?.destinationId !== trip.brief.destinationId
    )
      issues.push({
        code: "INVALID_ROUTE",
        message: `Choose a valid city route covering every trip day (up to ${MAX_TRIP_DAYS} days).`,
      });
    else if (trip.days.some((day, index) => day.date !== routeDayDate(trip.route!, index)))
      issues.push({
        code: "INVALID_DATES",
        message: "Trip dates must follow the route start date consecutively.",
      });
  }
  if (trip.lodgings) {
    const stayIds = new Set<string>();
    for (const choice of trip.lodgings) {
      const stay = trip.route?.stays.find((item) => item.id === choice.stayId);
      if (
        !stay ||
        (trip.route &&
          validRoute(trip.route) &&
          !routeStayDates(trip.route).some(
            (item) => item.id === choice.stayId && item.nights > 0,
          )) ||
        stayIds.has(choice.stayId) ||
        !validLodgingIdea(choice.candidate) ||
        stay.destinationId !== choice.candidate.destinationId
      )
        issues.push({
          code: "INVALID_LODGING",
          message:
            "Choose one lodging idea in the correct city for each existing city stay. Remove its lodging idea before removing a city.",
        });
      stayIds.add(choice.stayId);
    }
  }
  const placeIds = unique(trip.places, "Place");
  unique(trip.stops, "Stop");
  for (const place of trip.places) {
    if (
      !["demo", "qloo", "traveler"].includes(place.source) ||
      (place.source === "traveler" && !validOwnPlace(place))
    )
      issues.push({ code: "INVALID_PLACE", message: "Check the place name, pin and source." });
    if (place.facts && (place.source !== "qloo" || !validPlaceFacts(place.facts)))
      issues.push({
        code: "INVALID_FACTS",
        message: "Venue facts require valid provider provenance.",
      });
    if (
      !Number.isFinite(place.lat) ||
      place.lat < -90 ||
      place.lat > 90 ||
      !Number.isFinite(place.lng) ||
      place.lng < -180 ||
      place.lng > 180
    )
      issues.push({ code: "INVALID_COORDINATES", message: "A place has invalid coordinates." });
  }
  for (const stop of trip.stops) {
    if (
      stop.selection &&
      trip.places.some((place) => place.id === stop.placeId && place.source === "traveler")
    )
      issues.push({
        code: "INVALID_EVIDENCE",
        message: "Your own pins cannot carry Qloo selection evidence.",
        stopId: stop.id,
      });
    if (
      stop.note !== undefined &&
      (typeof stop.note !== "string" || !stop.note.trim() || stop.note.length > 2000)
    )
      issues.push({
        code: "INVALID_NOTE",
        message: "Keep a visit note within 2,000 characters.",
        stopId: stop.id,
      });
    if (
      stop.selection !== undefined &&
      (stop.selection === null ||
        typeof stop.selection !== "object" ||
        typeof stop.selection.queryId !== "string" ||
        !stop.selection.queryId.trim() ||
        !Number.isSafeInteger(stop.selection.rank) ||
        stop.selection.rank < 1 ||
        (stop.selection.score !== undefined &&
          (!Number.isFinite(stop.selection.score) ||
            stop.selection.score < 0 ||
            stop.selection.score > 1)))
    )
      issues.push({
        code: "INVALID_EVIDENCE",
        message: "A selected visit must retain its query identity and original rank.",
        stopId: stop.id,
      });
    if (!dayIds.has(stop.dayId))
      issues.push({
        code: "UNKNOWN_DAY",
        message: "This stop references a missing day.",
        stopId: stop.id,
      });
    if (!placeIds.has(stop.placeId))
      issues.push({
        code: "UNKNOWN_PLACE",
        message: "This stop references a missing place.",
        stopId: stop.id,
      });
    if (!trip.route || validRoute(trip.route)) {
      const place = trip.places.find((item) => item.id === stop.placeId);
      if (
        place &&
        (place.destinationId ?? trip.brief.destinationId) !== destinationForDay(trip, stop.dayId)
      )
        issues.push({
          code: "CITY_MISMATCH",
          message: "This visit belongs to another city. Keep it on a day in its own city.",
          stopId: stop.id,
        });
    }
    const start = minutes(stop.startTime);
    if (
      start === null ||
      !Number.isInteger(stop.durationMinutes) ||
      stop.durationMinutes < 1 ||
      (start !== null && start + stop.durationMinutes > 24 * 60)
    )
      issues.push({
        code: "INVALID_TIME",
        message: "Use a valid local time and a visit that finishes within the day.",
        stopId: stop.id,
      });
  }
  for (const day of trip.days) {
    if (
      !day.label.trim() ||
      day.label.length > 100 ||
      (day.note !== undefined && (typeof day.note !== "string" || day.note.length > 2000))
    )
      issues.push({
        code: "INVALID_DAY",
        message: "Use a day title up to 100 characters and notes up to 2,000 characters.",
      });
    const stops = getDayStops(trip, day.id);
    for (let index = 1; index < stops.length; index++) {
      const previous = stops[index - 1];
      const current = stops[index];
      if (!previous || !current) continue;
      const previousStart = minutes(previous.startTime);
      const currentStart = minutes(current.startTime);
      if (
        previousStart !== null &&
        currentStart !== null &&
        currentStart < previousStart + previous.durationMinutes
      )
        issues.push({
          code: "TIME_OVERLAP",
          message: "These visits overlap. Choose another time before applying the edit.",
          stopId: current.id,
        });
    }
  }
  if (trip.route && validRoute(trip.route)) {
    for (const stop of trip.stops) {
      if (minutes(stop.startTime) === null) continue;
      const issue = visitTravelIssue(trip, stop.dayId, stop.startTime, stop.durationMinutes);
      if (issue) issues.push({ ...issue, stopId: stop.id });
    }
  }
  return issues;
}

export function applyTripCommand(trip: Trip, command: TripCommand): CommandResult {
  if (!command.id?.trim() || !Array.isArray(command.operations) || command.operations.length === 0)
    return failure("INVALID_COMMAND", "Provide a command ID and at least one edit.");
  const signature = fingerprint({
    baseVersion: command.baseVersion,
    operations: command.operations,
  });
  const previous = replay(trip, command.id, signature);
  if (previous) return previous;
  if (command.baseVersion !== trip.version)
    return failure(
      "STALE_VERSION",
      "The trip changed while this edit was being prepared. Try the edit again against the current plan.",
    );
  const originalIssues = validateTrip(trip);
  if (originalIssues[0]) return { ok: false, error: originalIssues[0] };
  const next = structuredClone(trip);
  const affectedStopIds = new Set<string>();
  for (const operation of command.operations) {
    if (operation.type === "add-media") {
      if (!validMedia(operation.media))
        return failure("INVALID_MEDIA", "Choose a supported file or a valid web link.");
      if (next.media?.some((item) => item.id === operation.media.id))
        return failure("MEDIA_EXISTS", "This attachment is already saved.");
      next.media = [...(next.media ?? []), structuredClone(operation.media)];
      continue;
    }
    if (operation.type === "remove-media") {
      if (!next.media?.some((item) => item.id === operation.mediaId))
        return failure("MEDIA_NOT_FOUND", "This attachment is no longer in this trip.");
      next.media = next.media.filter((item) => item.id !== operation.mediaId);
      continue;
    }
    if (operation.type === "set-trip-request") {
      if (typeof operation.request !== "string" || operation.request.length > 2000)
        return failure("INVALID_REQUEST", "Keep the trip brief within 2,000 characters.");
      next.brief.details = {
        request: operation.request,
        flexibleMonths: [...(next.brief.details?.flexibleMonths ?? [])],
        travelers: next.brief.details?.travelers
          ? { ...next.brief.details.travelers }
          : { adults: next.brief.partySize, children: 0, infants: 0, pets: 0 },
      };
      continue;
    }
    if (operation.type === "set-travelers") {
      if (!validTravelers(operation.travelers))
        return failure(
          "INVALID_PARTY",
          "Choose at least one adult and up to 20 travelers, with up to 20 pets.",
        );
      const { adults, children, infants, pets } = operation.travelers;
      next.brief.partySize = adults + children + infants;
      next.brief.details = {
        request: next.brief.details?.request ?? "",
        flexibleMonths: [...(next.brief.details?.flexibleMonths ?? [])],
        travelers: { adults, children, infants, pets },
      };
      continue;
    }
    if (operation.type === "set-party-size") {
      if (
        !Number.isInteger(operation.partySize) ||
        operation.partySize < 1 ||
        operation.partySize > 20
      )
        return failure("INVALID_PARTY", "Choose between 1 and 20 travelers.");
      next.brief.partySize = operation.partySize;
      continue;
    }
    if (operation.type === "set-pace") {
      if (!["slow", "balanced", "full"].includes(operation.pace))
        return failure("INVALID_PACE", "Choose a supported travel pace.");
      next.brief.pace = operation.pace;
      continue;
    }
    if (operation.type === "set-activity-budget") {
      if (!validActivityBudget(operation.currency, operation.amountMinor))
        return failure(
          "INVALID_BUDGET",
          "Choose a supported budget currency and a nonnegative planning amount.",
        );
      next.brief.currency = operation.currency;
      next.brief.budget =
        operation.amountMinor === null
          ? null
          : operation.amountMinor / 10 ** COST_CURRENCIES[operation.currency];
      continue;
    }
    if (operation.type === "set-own-place") {
      if (!validOwnPlace(operation.place))
        return failure(
          "INVALID_PLACE",
          "Enter a place name, category and valid pin without provider evidence.",
        );
      const city = getTripDestination(next, operation.place.destinationId);
      if (
        !city ||
        ![
          next.brief.destinationId,
          ...(next.route?.stays.map((stay) => stay.destinationId) ?? []),
        ].includes(city.id)
      )
        return failure("UNKNOWN_CITY", "Choose a city in this trip for your place.");
      if (!ownPlaceNearCity(operation.place, city))
        return failure(
          "PIN_TOO_FAR",
          `Choose a pin within ${MAX_OWN_PLACE_DISTANCE_KM} km of ${city.name}.`,
        );
      const existing = next.places.find((place) => place.id === operation.place.id);
      if (
        existing &&
        (existing.source !== "traveler" || existing.destinationId !== operation.place.destinationId)
      )
        return failure("PLACE_ID_REUSED", "Keep this place's original city and identity.");
      if (!existing && next.places.length >= 150)
        return failure(
          "PLACE_LIMIT",
          "This trip holds up to 150 places. Remove an unused idea before adding another.",
        );
      const { id, name, destinationId, category, description, lat, lng } = operation.place;
      const place = {
        id,
        name,
        destinationId,
        category,
        description,
        lat,
        lng,
        source: "traveler" as const,
        practical: { hours: "unknown" as const, cost: "unknown" as const },
      };
      if (existing) next.places = next.places.map((item) => (item.id === id ? place : item));
      else next.places.push(place);
      for (const stop of next.stops) if (stop.placeId === id) affectedStopIds.add(stop.id);
      continue;
    }
    if (operation.type === "remove-place-idea") {
      const place = next.places.find((item) => item.id === operation.placeId);
      if (!place) return failure("UNKNOWN_PLACE", "Choose an existing place idea.");
      if (next.stops.some((stop) => stop.placeId === place.id))
        return failure("PLACE_IN_USE", "Remove this place's visits before removing its idea.");
      next.places = next.places.filter((item) => item.id !== place.id);
      continue;
    }
    if (operation.type === "set-title" && !validTripTitle(operation.title))
      return failure("INVALID_TITLE", "Use a trip name of up to 120 characters on one line.");
    if (operation.type === "set-trip-title" || operation.type === "set-title") {
      if (
        typeof operation.title !== "string" ||
        (operation.title.trim() && !validTripTitle(operation.title.trim()))
      )
        return failure("INVALID_TITLE", "Use a trip name of up to 120 characters on one line.");
      if (operation.title.trim()) next.title = operation.title.trim();
      else delete next.title;
      continue;
    }
    if (operation.type === "set-cost") {
      if (!validTripCost(operation.cost))
        return failure("INVALID_COST", "Check the cost label, currency, amount and quantity.");
      const costs = next.costs ?? [];
      const index = costs.findIndex((cost) => cost.id === operation.cost.id);
      if (index < 0 && costs.length >= 100)
        return failure("COST_LIMIT", "A trip can hold up to 100 recorded costs.");
      next.costs =
        index < 0
          ? [...costs, structuredClone(operation.cost)]
          : costs.map((cost, position) =>
              position === index ? structuredClone(operation.cost) : cost,
            );
      continue;
    }
    if (operation.type === "remove-cost") {
      if (!next.costs?.some((cost) => cost.id === operation.costId))
        return failure("COST_NOT_FOUND", "That recorded cost is no longer in this trip.");
      next.costs = next.costs.filter((cost) => cost.id !== operation.costId);
      continue;
    }
    if (operation.type === "select-lodging") {
      if (!validLodgingIdea(operation.candidate))
        return failure("INVALID_LODGING", "This lodging suggestion could not be validated.");
      next.lodgings = [
        ...(next.lodgings ?? []).filter((choice) => choice.stayId !== operation.stayId),
        { stayId: operation.stayId, candidate: structuredClone(operation.candidate) },
      ];
      continue;
    }
    if (operation.type === "remove-lodging") {
      next.lodgings = (next.lodgings ?? []).filter((choice) => choice.stayId !== operation.stayId);
      continue;
    }
    if (operation.type === "add-candidates") {
      if (
        !getTripDestination(next, operation.destinationId) ||
        !Array.isArray(operation.places) ||
        operation.places.length < 1 ||
        operation.places.length > 100 ||
        operation.places.some((place) => place.source !== "qloo")
      )
        return failure(
          "INVALID_CANDIDATES",
          "Only verified Qloo candidate records can be imported into this city.",
        );
      let imported: Trip["places"];
      try {
        imported = createTripFromPlaces(
          {
            ...next.brief,
            destinationId: operation.destinationId,
            destination: getTripDestination(next, operation.destinationId),
            days: 1,
          },
          operation.places,
        ).places;
      } catch {
        return failure("INVALID_CANDIDATES", "The recommendation records could not be validated.");
      }
      for (const place of imported) {
        const existing = next.places.find((item) => item.id === place.id);
        if (existing) {
          if ((existing.destinationId ?? next.brief.destinationId) !== operation.destinationId)
            return failure("CITY_MISMATCH", "This candidate already belongs to another city.");
          if (place.facts) existing.facts = structuredClone(place.facts);
          // Retain original evidence for already accepted place identities.
          continue;
        }
        next.places.push(place);
      }
      if (next.places.length > 150)
        return failure("INVENTORY_LIMIT", "This trip supports up to 150 candidate places.");
      continue;
    }
    if (operation.type === "add-stop") {
      const visit = operation.stop;
      if (
        !visit ||
        typeof visit.id !== "string" ||
        !visit.id.trim() ||
        next.stops.some((item) => item.id === visit.id) ||
        typeof visit.pinned !== "boolean" ||
        typeof visit.timeLocked !== "boolean"
      )
        return failure("INVALID_STOP", "Provide a new visit identity with valid visit settings.");
      const selected = structuredClone(visit);
      const place = next.places.find((item) => item.id === visit.placeId);
      if (selected.selection === undefined && place?.source === "qloo" && place.taste)
        selected.selection = structuredClone(place.taste);
      next.stops.push(selected);
      affectedStopIds.add(visit.id);
      continue;
    }
    if (operation.type === "annotate-day") {
      const day = next.days.find((item) => item.id === operation.dayId);
      if (!day || typeof operation.label !== "string" || typeof operation.note !== "string")
        return failure("INVALID_DAY", "Choose a trip day and a valid title and note.");
      day.label = operation.label.trim();
      if (operation.note) day.note = operation.note;
      else delete day.note;
      continue;
    }
    if (operation.type === "set-route") {
      if (!validRoute(operation.route))
        return failure(
          "INVALID_ROUTE",
          `Check the city route and travel times. Arrival must follow departure and fall on the first day in the next city; use a valid clock-change offset where needed. Routes support up to ${MAX_TRIP_DAYS} days.`,
        );
      if (operation.route.stays[0]?.destinationId !== next.brief.destinationId)
        return failure(
          "INVALID_ROUTE",
          "Keep the starting city of this draft. Start a new trip to change it.",
        );
      const count = operation.route.stays.reduce((sum, stay) => sum + stay.days, 0);
      if (next.stops.some((item) => next.days.findIndex((day) => day.id === item.dayId) >= count))
        return failure("DAYS_HAVE_VISITS", "Remove visits from the days you want to delete first.");
      next.route = structuredClone(operation.route);
      next.days = Array.from({ length: count }, (_, index) => ({
        id: next.days[index]?.id ?? `day-${index + 1}`,
        label: next.days[index]?.label ?? `Day ${index + 1}`,
        ...(next.days[index]?.note ? { note: next.days[index]?.note } : {}),
        date: routeDayDate(operation.route, index),
      }));
      next.brief.days = count;
      continue;
    }
    const stop = next.stops.find((item) => item.id === operation.stopId);
    if (!stop)
      return failure("UNKNOWN_STOP", "That visit is no longer in the trip.", operation.stopId);
    affectedStopIds.add(stop.id);
    switch (operation.type) {
      case "set-stop-note":
        if (typeof operation.note !== "string" || operation.note.length > 2000)
          return failure("INVALID_NOTE", "Keep a visit note within 2,000 characters.", stop.id);
        if (operation.note.trim()) stop.note = operation.note.trim();
        else delete stop.note;
        break;
      case "set-duration":
        if (stop.timeLocked && operation.durationMinutes !== stop.durationMinutes)
          return failure(
            "TIME_LOCKED",
            "Unlock this visit's time before changing its duration.",
            stop.id,
          );
        stop.durationMinutes = operation.durationMinutes;
        break;
      case "rate-stop":
        if (operation.feedback !== null && !["more", "less"].includes(operation.feedback))
          return failure("INVALID_COMMAND", "Choose more like this or less like this.", stop.id);
        if (operation.feedback === null) delete stop.feedback;
        else stop.feedback = operation.feedback;
        break;
      case "pin-stop":
        if (typeof operation.pinned !== "boolean")
          return failure("INVALID_COMMAND", "Place pin must be on or off.", stop.id);
        stop.pinned = operation.pinned;
        break;
      case "lock-time":
        if (typeof operation.timeLocked !== "boolean")
          return failure("INVALID_COMMAND", "Time lock must be on or off.", stop.id);
        stop.timeLocked = operation.timeLocked;
        break;
      case "remove-stop":
        if (stop.pinned || stop.timeLocked)
          return failure(
            "STOP_LOCKED",
            "Unpin this visit and unlock its time before removing it.",
            stop.id,
          );
        next.stops = next.stops.filter((item) => item.id !== stop.id);
        break;
      case "move-stop":
        if (
          stop.timeLocked &&
          (stop.dayId !== operation.dayId || stop.startTime !== operation.startTime)
        )
          return failure("TIME_LOCKED", "Unlock this visit's time before moving it.", stop.id);
        if (!next.days.some((day) => day.id === operation.dayId))
          return failure("UNKNOWN_DAY", "Choose a day in this trip.", stop.id);
        stop.dayId = operation.dayId;
        stop.startTime = operation.startTime;
        break;
      case "set-start-time":
        if (stop.timeLocked && stop.startTime !== operation.startTime)
          return failure("TIME_LOCKED", "Unlock this visit's time before changing it.", stop.id);
        stop.startTime = operation.startTime;
        break;
      case "replace-stop":
        if (stop.pinned && stop.placeId !== operation.placeId)
          return failure("PLACE_PINNED", "Unpin this place before replacing it.", stop.id);
        if (!next.places.some((place) => place.id === operation.placeId))
          return failure("UNKNOWN_PLACE", "The replacement must be a known candidate.", stop.id);
        if (stop.placeId !== operation.placeId) {
          const replacement = next.places.find((place) => place.id === operation.placeId);
          delete stop.feedback;
          delete stop.note;
          if (replacement?.taste) stop.selection = structuredClone(replacement.taste);
          else delete stop.selection;
        }
        stop.placeId = operation.placeId;
        break;
      default:
        return failure("INVALID_COMMAND", "This edit type is not supported.");
    }
  }
  const issues = validateTrip(next);
  if (issues[0]) return { ok: false, error: issues[0] };
  next.version = trip.version + 1;
  next.updatedAt = new Date().toISOString();
  next.appliedCommandIds.push(command.id);
  const receipt: CommandReceipt = {
    commandId: command.id,
    fingerprint: signature,
    beforeVersion: trip.version,
    afterVersion: next.version,
    before: snapshot(trip),
    affectedStopIds: [...affectedStopIds],
  };
  next.commandLog = [...(trip.commandLog ?? []), receipt];
  return { ok: true, trip: next, receipt, replayed: false };
}

/** Undo is another accepted command; intervening edits require a fresh proposal. */
export function undoTripCommand(
  trip: Trip,
  receipt: CommandReceipt,
  commandId: string,
): CommandResult {
  if (!commandId?.trim()) return failure("INVALID_COMMAND", "Provide an undo command ID.");
  const signature = fingerprint({ undoOf: receipt.commandId, afterVersion: receipt.afterVersion });
  const previous = replay(trip, commandId, signature);
  if (previous) return previous;
  const recorded = trip.commandLog?.find((item) => item.commandId === receipt.commandId);
  if (!recorded || recorded.before.id !== trip.id || recorded.afterVersion !== receipt.afterVersion)
    return failure("UNKNOWN_RECEIPT", "This edit receipt does not belong to the current trip.");
  if (trip.version !== recorded.afterVersion)
    return failure(
      "UNDO_CONFLICT",
      "The trip changed after this edit. Undo the latest edit or make a new change.",
    );
  const next: Trip = {
    ...structuredClone(recorded.before),
    version: trip.version + 1,
    updatedAt: new Date().toISOString(),
    appliedCommandIds: [...trip.appliedCommandIds, commandId],
  };
  const undoReceipt: CommandReceipt = {
    commandId,
    fingerprint: signature,
    beforeVersion: trip.version,
    afterVersion: next.version,
    before: snapshot(trip),
    affectedStopIds: [...recorded.affectedStopIds],
  };
  next.commandLog = [...(trip.commandLog ?? []), undoReceipt];
  const issues = validateTrip(next);
  if (issues[0]) return { ok: false, error: issues[0] };
  return { ok: true, trip: next, receipt: undoReceipt, replayed: false };
}
