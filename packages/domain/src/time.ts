import { Temporal } from "@js-temporal/polyfill";
import type { LocalTravelTime } from "./types";

/** Never silently choose one occurrence of a repeated clock hour or shift a skipped time. */
export function localTimeEpoch(value: LocalTravelTime, timeZone: string): number {
  if (
    !value ||
    typeof value !== "object" ||
    typeof value.date !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(value.date) ||
    typeof value.time !== "string" ||
    !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ||
    (value.utcOffset !== undefined &&
      (typeof value.utcOffset !== "string" ||
        !/^[+-]([01]\d|2[0-3]):[0-5]\d$/.test(value.utcOffset)))
  )
    throw new Error("Enter a valid local date, time and optional UTC offset.");
  try {
    return Temporal.ZonedDateTime.from(
      `${value.date}T${value.time}${value.utcOffset ?? ""}[${timeZone}]`,
      { disambiguation: "reject", offset: "reject" },
    ).epochMilliseconds;
  } catch {
    throw new Error(
      `Check ${value.date} ${value.time} in ${timeZone}. Skipped clock times cannot be used; a repeated clock hour needs its correct UTC offset.`,
    );
  }
}

export function calendarUtc(epoch: number): string {
  return new Date(epoch)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}
