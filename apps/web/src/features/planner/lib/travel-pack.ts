import {
  calendarUtc,
  costLineTotal,
  dateAt,
  destinationForDay,
  formatCost,
  getDayStops,
  getTripDestination,
  getTripTitle,
  localTimeEpoch,
  lodgingAddress,
  lodgingWebsite,
  routeStayDates,
  type Trip,
  transfersForDay,
  transferWindow,
  tripCostTotals,
} from "@tastip/domain";
import { placeSourceLabel } from "./place-labels";
import { activityBudgetAmount, PACE_LABELS } from "./trip-details";

export function tripTitle(trip: Trip): string {
  return getTripTitle(trip);
}

export function visitEnd(start: string, duration: number): string {
  const minutes = Number(start.slice(0, 2)) * 60 + Number(start.slice(3)) + duration;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

/** Text escaping prevents content from becoming a new calendar property or event. */
export function escapeCalendarText(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,");
}

/** RFC 5545: fold at 75 octets without splitting a UTF-8 character. */
export function foldCalendarLine(line: string): string {
  const encoder = new TextEncoder();
  const lines: string[] = [];
  let current = "";
  let size = 0;
  for (const character of line) {
    const width = encoder.encode(character).length;
    if (size + width > 75) {
      lines.push(current);
      current = " ";
      size = 1;
    }
    current += character;
    size += width;
  }
  lines.push(current);
  return lines.join("\r\n");
}

/** Resolve the destination clock explicitly; gaps and repeated hours require correction. */
export function localVisitUtc(date: string, time: string, timeZone: string): string {
  return calendarUtc(localTimeEpoch({ date, time }, timeZone));
}

export function buildCalendar(trip: Trip): string {
  if (trip.days.some((day) => !day.date))
    throw new Error("Set trip dates before downloading a calendar.");
  const stamp = new Date(trip.updatedAt)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Tastip//Travel draft//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeCalendarText(`${tripTitle(trip)} · Tastip draft`)}`,
  ];
  for (const day of trip.days) {
    if (!day.date) continue;
    const city = getTripDestination(trip, destinationForDay(trip, day.id));
    if (!city) throw new Error("Choose a supported destination before exporting.");
    for (const stop of getDayStops(trip, day.id)) {
      const place = trip.places.find((item) => item.id === stop.placeId);
      if (!place) continue;
      const startEpoch = localTimeEpoch({ date: day.date, time: stop.startTime }, city.timeZone);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${encodeURIComponent(trip.id)}-${encodeURIComponent(stop.id)}@tastip.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART:${calendarUtc(startEpoch)}`,
        `DTEND:${calendarUtc(startEpoch + stop.durationMinutes * 60_000)}`,
        `SUMMARY:${escapeCalendarText(`${place.source === "demo" ? "[Fictional sample] " : place.source === "traveler" ? "[Your pin] " : ""}${place.name}`)}`,
        `LOCATION:${escapeCalendarText(`${place.name}, ${city.name}`)}`,
        `DESCRIPTION:${escapeCalendarText(`Tastip draft, not a booking. ${city.timeZone} local time. Opening hours, travel duration, availability and costs are unverified. ${place.description}${stop.note ? `\nYour private visit note: ${stop.note}` : ""}`)}`,
        "STATUS:TENTATIVE",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
    }
  }
  if (trip.route) {
    const stays = routeStayDates(trip.route);
    for (const choice of trip.lodgings ?? []) {
      const stay = stays.find((item) => item.id === choice.stayId);
      if (!stay || stay.nights < 1 || !stay.arrival || !stay.departure) continue;
      lines.push(
        "BEGIN:VEVENT",
        `UID:${encodeURIComponent(trip.id)}-lodging-${encodeURIComponent(choice.stayId)}@tastip.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${stay.arrival.replaceAll("-", "")}`,
        `DTEND;VALUE=DATE:${stay.departure.replaceAll("-", "")}`,
        `SUMMARY:${escapeCalendarText(`Planned stay — ${choice.candidate.name}`)}`,
        `LOCATION:${escapeCalendarText([choice.candidate.name, lodgingAddress(choice.candidate)].filter(Boolean).join(", "))}`,
        `DESCRIPTION:${escapeCalendarText("Lodging idea only. Not reserved; confirm rates, dates and availability directly with the property.")}`,
        "STATUS:TENTATIVE",
        "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
    }
    for (const [index, transfer] of trip.route.transfers.entries()) {
      const stay = stays[index + 1];
      if (!stay || !stay.arrival) continue;
      const from = getTripDestination(trip, stays[index]!.destinationId)?.name ?? "Previous city";
      const to = getTripDestination(trip, stay.destinationId)?.name ?? "Next city";
      const window = transferWindow(trip.route, index);
      lines.push(
        "BEGIN:VEVENT",
        `UID:${encodeURIComponent(trip.id)}-transfer-${encodeURIComponent(transfer.id)}@tastip.local`,
        `DTSTAMP:${stamp}`,
        window
          ? `DTSTART:${calendarUtc(window.departureEpoch)}`
          : `DTSTART;VALUE=DATE:${stay.arrival.replaceAll("-", "")}`,
        window
          ? `DTEND:${calendarUtc(window.arrivalEpoch)}`
          : `DTEND;VALUE=DATE:${dateAt(stay.arrival, 1).replaceAll("-", "")}`,
        `SUMMARY:${escapeCalendarText(`${window ? "Planned travel" : "Transfer idea"} — ${from} to ${to}`)}`,
        `DESCRIPTION:${escapeCalendarText(`Preferred mode: ${transfer.mode}. ${window ? `Times entered by traveler: ${window.timing.departure.date} ${window.timing.departure.time} ${window.from.timeZone} to ${window.timing.arrival.date} ${window.timing.arrival.time} ${window.to.timeZone}.` : "Timing is unverified."} Route, service availability and booking are unverified.`)}`,
        "STATUS:TENTATIVE",
        window ? "TRANSP:OPAQUE" : "TRANSP:TRANSPARENT",
        "END:VEVENT",
      );
    }
  }
  lines.push("END:VCALENDAR");
  return `${lines.map(foldCalendarLine).join("\r\n")}\r\n`;
}

function html(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function buildPrintableTrip(trip: Trip): string {
  const planningDetails = `<p>${html(PACE_LABELS[trip.brief.pace])} · Activity budget: ${html(activityBudgetAmount(trip.brief) ?? "not set")}. For all travelers across the whole trip; travel and lodging are excluded.</p>`;
  const sections = trip.days
    .map((day) => {
      const city = getTripDestination(trip, destinationForDay(trip, day.id));
      const stops = getDayStops(trip, day.id)
        .map((stop) => {
          const place = trip.places.find((item) => item.id === stop.placeId);
          return place
            ? `<li><time>${html(stop.startTime)}–${html(visitEnd(stop.startTime, stop.durationMinutes))}</time><div><strong>${html(place.name)}</strong><p>${html(place.description)}</p>${stop.note ? `<p style="white-space:pre-wrap"><strong>Your private visit note:</strong> ${html(stop.note)}</p>` : ""}<small>${place.source === "qloo" ? `Qloo original rank ${(stop.selection ?? place.taste)?.rank ?? "unknown"}` : placeSourceLabel(place)} · Hours, costs & travel unverified</small></div></li>`
            : "";
        })
        .join("");
      const travel = transfersForDay(trip, day.id)
        .map(
          ({ timing, from, to, transfer }) =>
            `<p><strong>Reserved travel time · ${html(from.name)} → ${html(to.name)}</strong><br>${html(timing.departure.date)} ${html(timing.departure.time)} ${html(from.timeZone)} → ${html(timing.arrival.date)} ${html(timing.arrival.time)} ${html(to.timeZone)} · ${html(transfer.mode)}<br>Times entered by you. Not a reservation.</p>`,
        )
        .join("");
      return `<section><h2>${html(day.label)} · ${html(city?.name ?? "City not set")}</h2><p class="day-meta">${html(day.date ?? "Dates open")} · ${html(city?.timeZone ?? "Local time")}</p>${travel}${day.note ? `<p><strong>Day note:</strong> ${html(day.note)}</p>` : ""}${stops ? `<ol>${stops}</ol>` : "<p>No visits scheduled. Leave room for travel and discovery.</p>"}</section>`;
    })
    .join("");
  const lodgings = trip.route
    ? (trip.lodgings ?? [])
        .map((choice) => {
          const stay = routeStayDates(trip.route!).find((item) => item.id === choice.stayId);
          const website = lodgingWebsite(choice.candidate);
          return `<section><h2>Lodging idea · ${html(choice.candidate.name)}</h2><p>${html(stay?.arrival ?? "Date open")} → ${html(stay?.departure ?? "Date open")} · ${stay?.nights ?? 0} nights · not reserved.</p><p>${choice.candidate.source === "traveler" ? "Entered by you · details unverified" : "Qloo lodging suggestion"}</p><p>${html(lodgingAddress(choice.candidate) ?? "Check details with the property.")}</p>${website ? `<p><a href="${html(website)}" target="_blank" rel="noopener noreferrer">Open lodging link</a></p>` : ""}</section>`;
        })
        .join("")
    : "";
  const preferences = trip.brief.tasteProfile;
  const costs = trip.costs?.length
    ? `<section><h2>Planned costs · entered by you</h2><p>Unverified planning amounts. Missing costs are excluded. Each currency is separate; no exchange rates are applied.</p><ol>${trip.costs.map((cost) => `<li><div><strong>${html(cost.label)} · ${html(formatCost(costLineTotal(cost, trip.brief.partySize), cost.currency))}</strong><p>${html(cost.category)} · ${html(formatCost(cost.unitAmountMinor, cost.currency))} × ${cost.quantity}${cost.appliesTo === "each-traveler" ? ` × ${trip.brief.partySize} travelers` : " · whole party"}</p></div></li>`).join("")}</ol><p>${tripCostTotals(
        trip,
      )
        .map(
          (group) =>
            `${html(group.currency)} recorded subtotal: ${html(formatCost(group.totalMinor, group.currency))}`,
        )
        .join("<br>")}</p></section>`
    : "";
  const preferenceSummary = preferences
    ? `<p><strong>Your preferences to confirm:</strong> ${html([preferences.dayStyle, preferences.rhythm ? `${preferences.rhythm} rhythm` : "", preferences.dietary?.join(", ") ?? "", preferences.walking ? `${preferences.walking} walks` : "", preferences.lodging ?? ""].filter(Boolean).join(" · "))}. Dietary suitability, distances and lodging style are not independently verified.</p>`
    : "";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${html(tripTitle(trip))} · Tastip itinerary</title><style>body{max-width:860px;margin:48px auto;padding:0 24px;color:#25392f;background:#faf9f5;font:15px/1.6 system-ui,sans-serif}h1{font:48px/1.15 Georgia,serif;overflow-wrap:anywhere}h2{font:28px Georgia,serif;margin-bottom:4px}.eyebrow{letter-spacing:.18em;font-size:11px}.day-meta,small{color:#677168}section{padding:24px 0;border-top:1px solid #d4d8ce;break-inside:avoid}ol{list-style:none;padding:0}li{display:flex;gap:28px;margin:24px 0}time{white-space:nowrap;font-variant-numeric:tabular-nums}li p{margin:4px 0}footer{border-top:1px solid #d4d8ce;padding-top:24px;font-size:12px}@media print{body{background:white;margin:0}h1{font-size:36px}section{break-inside:auto}li{break-inside:avoid}}</style></head><body><p class="eyebrow">TASTIP · YOUR TRAVEL DRAFT</p><h1>${html(tripTitle(trip))}</h1><p>${trip.days.length} ${trip.days.length === 1 ? "day" : "days"} · ${trip.brief.partySize} ${trip.brief.partySize === 1 ? "traveler" : "travelers"} · draft v${trip.version}</p><p>This is a planning draft, not a booking. Confirm venue opening hours, reservations, travel times, accessibility and costs before departure. All times are local to the listed destination.</p>${planningDetails}${preferenceSummary}${lodgings}${sections}${costs}<footer>Generated from your accepted Tastip trip. Keep this file somewhere private. It contains your itinerary and is not a live shared document.</footer></body></html>`;
}

export function placeMapUrl(lat: number, lng: number): string {
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)
    throw new Error("Map coordinates are invalid.");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${lat},${lng}`)}`;
}

export function placeDirectionsUrl(lat: number, lng: number): string {
  // Reuse validation; origin is chosen by the traveler inside Maps.
  placeMapUrl(lat, lng);
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${lat},${lng}`)}`;
}
