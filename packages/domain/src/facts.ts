import type { Place, Trip } from "./types";

export const WEEKDAYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;
export type WeeklyHours = Partial<
  Record<
    (typeof WEEKDAYS)[number],
    { opens: string | null; closes: string | null; closed: boolean }[]
  >
>;
export type PlaceFacts = {
  source: "qloo";
  retrievedAt: string;
  address?: string;
  website?: string;
  menuUrl?: string;
  phone?: string;
  specialtyDishes?: string;
  cuisine?: string;
  imageUrl?: string;
  hours?: WeeklyHours;
};

export function safePublicLink(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 2000) return false;
  try {
    const url = new URL(value);
    return (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    );
  } catch {
    return false;
  }
}
export function validPlaceFacts(value: unknown): value is PlaceFacts {
  if (!value || typeof value !== "object") return false;
  const facts = value as PlaceFacts;
  if (
    facts.source !== "qloo" ||
    typeof facts.retrievedAt !== "string" ||
    !Number.isFinite(Date.parse(facts.retrievedAt))
  )
    return false;
  if (
    [facts.address, facts.phone, facts.specialtyDishes, facts.cuisine].some(
      (text) => text !== undefined && (typeof text !== "string" || text.length > 500),
    )
  )
    return false;
  if ([facts.website, facts.menuUrl].some((link) => link !== undefined && !safePublicLink(link)))
    return false;
  if (facts.imageUrl !== undefined) {
    if (!safePublicLink(facts.imageUrl)) return false;
    const url = new URL(facts.imageUrl);
    if (url.protocol !== "https:" || url.hostname !== "images.qloo.com") return false;
  }
  if (facts.hours !== undefined) {
    if (!facts.hours || typeof facts.hours !== "object" || Array.isArray(facts.hours)) return false;
    for (const [day, periods] of Object.entries(facts.hours)) {
      if (
        !WEEKDAYS.includes(day as (typeof WEEKDAYS)[number]) ||
        !Array.isArray(periods) ||
        periods.length > 8
      )
        return false;
      for (const period of periods) {
        if (
          !period ||
          typeof period.closed !== "boolean" ||
          ![period.opens, period.closes].every(
            (time) =>
              time === null ||
              (typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/.test(time)),
          )
        )
          return false;
      }
    }
  }
  return true;
}

export function hoursForDate(place: Place, date: string | null) {
  if (!date || !place.facts?.hours) return undefined;
  const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  return weekday ? place.facts.hours[weekday] : undefined;
}

export type PlaceHoursWarning = { kind: "closed" | "outside"; message: string };

/** Provider-hour warnings are advisory; unknown or overnight coverage stays unasserted. */
export function listedHoursWarning(
  place: Place,
  date: string | null,
  startTime: string,
  durationMinutes: number,
): PlaceHoursWarning | null {
  if (
    place.source !== "qloo" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(startTime) ||
    !Number.isInteger(durationMinutes) ||
    durationMinutes < 1
  )
    return null;
  const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const start = minute(startTime);
  if (start + durationMinutes > 1440) return null;
  const hours = hoursForDate(place, date);
  if (!hours?.length) return null;
  if (hours.every((period) => period.closed))
    return {
      kind: "closed",
      message: `${place.name}: Qloo lists this weekday as closed. Confirm with the venue before keeping this visit.`,
    };
  // The preceding day's overnight opening may cover this time; do not invent that coverage.
  if (
    hours.some(
      (period) =>
        !period.closed &&
        (!period.opens || !period.closes || minute(period.closes) <= minute(period.opens)),
    )
  )
    return null;
  if (
    !hours.some(
      (period) =>
        !period.closed &&
        period.opens &&
        period.closes &&
        start >= minute(period.opens) &&
        start + durationMinutes <= minute(period.closes),
    )
  )
    return {
      kind: "outside",
      message: `${place.name}: this visit falls outside Qloo’s listed weekday hours. Review the time or confirm with the venue.`,
    };
  return null;
}

/** Provider-hour warnings do not establish holiday, travel or dietary verification. */
export function dayFactWarnings(trip: Trip, dayId: string) {
  const date = trip.days.find((day) => day.id === dayId)?.date ?? null;
  return trip.stops
    .filter((stop) => stop.dayId === dayId)
    .flatMap((stop) => {
      const place = trip.places.find((item) => item.id === stop.placeId);
      const warning =
        place && listedHoursWarning(place, date, stop.startTime, stop.durationMinutes);
      return warning ? [{ stopId: stop.id, message: warning.message }] : [];
    });
}
