import { hoursForDate, validPlaceFacts } from "./facts";
import type { Place } from "./types";

const minute = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
const clock = (time: number) =>
  `${String(Math.floor(time / 60)).padStart(2, "0")}:${String(time % 60).padStart(2, "0")}`;

/** Automatic drafts only. Listed weekly hours never establish live/holiday availability. */
export function listedDraftVisitTime(
  place: Place,
  date: string | null,
  preferred: string,
  earliest: number,
  latest: number,
  available: (time: string) => boolean,
  duration = 60,
): string | null {
  const fallback = () => (available(preferred) ? preferred : null);
  const hours =
    place.source === "qloo" && validPlaceFacts(place.facts) ? hoursForDate(place, date) : undefined;
  if (!hours?.length) return fallback();
  if (hours.every((period) => period.closed)) return null;
  const open = hours.filter((period) => !period.closed);
  // An incomplete/equal-ended period does not establish a bounded opening window.
  if (open.some((period) => !period.opens || !period.closes || period.opens === period.closes))
    return fallback();
  const windows = open
    .map((period) => {
      const start = minute(period.opens ?? "00:00");
      const end = minute(period.closes ?? "00:00");
      // Use only the same-date part of an overnight opening, never inferred prior-day coverage.
      return { start: Math.max(start, earliest), end: Math.min(end < start ? 1440 : end, latest) };
    })
    .filter((window) => window.start + duration <= window.end);
  if (!windows.length) return null;
  const target = minute(preferred);
  // At most one day's minutes; nearest feasible clock time, earlier time wins ties.
  for (let distance = 0; distance < 1440; distance++) {
    for (const start of distance ? [target - distance, target + distance] : [target]) {
      if (
        start >= earliest &&
        start + duration <= latest &&
        windows.some((window) => start >= window.start && start + duration <= window.end) &&
        available(clock(start))
      )
        return clock(start);
    }
  }
  return null;
}
