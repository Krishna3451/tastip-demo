import { describe, expect, test } from "bun:test";
import { applyTripCommand, createDemoTrip, DEFAULT_BRIEF } from "@tastip/domain";
import {
  buildCalendar,
  buildPrintableTrip,
  escapeCalendarText,
  foldCalendarLine,
  localVisitUtc,
  placeDirectionsUrl,
  placeMapUrl,
  tripTitle,
} from "./travel-pack";

function datedTrip() {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const result = applyTripCommand(trip, {
    id: "date-export",
    baseVersion: 1,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-02-28",
          stays: [{ id: "lisbon", destinationId: "lisbon", days: 3 }],
          transfers: [],
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.trip;
}

describe("private travel pack", () => {
  test("traveler pins export their source without inventing Qloo rank", () => {
    const trip = datedTrip();
    trip.places.push({
      id: "traveler:export",
      name: "Own <pin>",
      destinationId: "lisbon",
      category: "outdoors",
      description: "Location entered by traveler",
      lat: 38.72,
      lng: -9.14,
      source: "traveler",
      practical: { hours: "unknown", cost: "unknown" },
    });
    trip.stops.push({
      id: "own-export-stop",
      placeId: "traveler:export",
      dayId: "day-1",
      startTime: "15:30",
      durationMinutes: 60,
      pinned: false,
      timeLocked: false,
    });
    const printed = buildPrintableTrip(trip);
    expect(printed).toContain("Own &lt;pin&gt;");
    expect(printed).toContain("Traveler-added pin · location unverified");
    expect(printed).not.toContain("Qloo original rank");
    expect(buildCalendar(trip)).toContain("SUMMARY:[Your pin] Own <pin>");
  });
  test("private visit notes export as escaped text rather than markup or new calendar events", () => {
    const trip = datedTrip();
    trip.stops[0]!.note = "<script>reminder</script>\nBEGIN:VEVENT\nSUMMARY:injected";
    const printed = buildPrintableTrip(trip);
    expect(printed).toContain("Your private visit note:");
    expect(printed).toContain("&lt;script&gt;reminder&lt;/script&gt;");
    expect(printed).not.toContain("<script>reminder</script>");
    const calendar = buildCalendar(trip).replaceAll("\r\n ", "");
    expect(calendar).toContain(
      "Your private visit note: <script>reminder</script>\\nBEGIN:VEVENT\\nSUMMARY:injected",
    );
    expect(calendar.match(/^BEGIN:VEVENT$/gm)).toHaveLength(trip.stops.length);
  });
  test("accepted trip names reach escaped print and calendar metadata", () => {
    const trip = datedTrip();
    trip.title = 'Lisbon <slowly> & "well"';
    expect(tripTitle(trip)).toBe(trip.title);
    const printed = buildPrintableTrip(trip);
    expect(printed).toContain("Lisbon &lt;slowly&gt; &amp; &quot;well&quot;");
    expect(printed).not.toContain("<slowly>");
    expect(buildCalendar(trip)).toContain('X-WR-CALNAME:Lisbon <slowly> & "well" · Tastip draft');
  });
  test("traveler lodging exports private address and safe handoff with truthful source labels", () => {
    const trip = datedTrip();
    trip.lodgings = [
      {
        stayId: "lisbon",
        candidate: {
          id: "own-stay",
          name: "My stay <fixture>",
          destinationId: "lisbon",
          source: "traveler",
          address: "Private address, second floor",
          website: "https://example.test/stay?a=1&b=2",
        },
      },
    ];
    const printed = buildPrintableTrip(trip);
    expect(printed).toContain("My stay &lt;fixture&gt;");
    expect(printed).toContain("Entered by you · details unverified");
    expect(printed).toContain("Private address, second floor");
    expect(printed).toContain('href="https://example.test/stay?a=1&amp;b=2"');
    const calendar = buildCalendar(trip).replaceAll("\r\n ", "");
    expect(calendar).toContain("LOCATION:My stay <fixture>\\, Private address\\, second floor");
    expect(calendar).toContain("Lodging idea only");
    expect(calendar).not.toContain("Confirmed");
  });
  test("print includes escaped manual costs with separate currency subtotals", () => {
    const trip = datedTrip();
    trip.costs = [
      {
        id: "museum",
        label: '<script>alert("cost")</script>',
        category: "activity",
        currency: "EUR",
        unitAmountMinor: 1250,
        quantity: 2,
        appliesTo: "each-traveler",
        source: "traveler",
      },
      {
        id: "train",
        label: "Rail plan",
        category: "transport",
        currency: "JPY",
        unitAmountMinor: 1500,
        quantity: 1,
        appliesTo: "party",
        source: "traveler",
      },
    ];
    const printed = buildPrintableTrip(trip);
    expect(printed).toContain("Planned costs · entered by you");
    expect(printed).toContain("&lt;script&gt;");
    expect(printed).not.toContain('<script>alert("cost")</script>');
    expect(printed).toContain("EUR recorded subtotal: EUR");
    expect(printed).toContain("JPY recorded subtotal: JPY");
    expect(printed).toContain("no exchange rates are applied");
    expect(buildCalendar(trip)).not.toContain("Rail plan");
  });
  test("exports destination-local visits as UTC calendar events without machine timezone dependence", () => {
    expect(localVisitUtc("2028-07-10", "09:30", "Europe/Lisbon")).toBe("20280710T083000Z");
    expect(localVisitUtc("2028-01-10", "09:30", "Europe/Lisbon")).toBe("20280110T093000Z");
    expect(localVisitUtc("2028-07-10", "09:30", "Asia/Tokyo")).toBe("20280710T003000Z");
    const calendar = buildCalendar(datedTrip());
    expect(calendar).toContain("DTSTART:20280228T093000Z\r\n");
    expect(calendar).toContain("DTEND:20280228T103000Z\r\n");
    expect(calendar).toContain("STATUS:TENTATIVE");
    expect(calendar).toContain("[Fictional sample]");
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(() => buildCalendar(createDemoTrip(DEFAULT_BRIEF))).toThrow("Set trip dates");
  });
  test("rejects nonexistent daylight-saving wall times instead of silently moving visits", () => {
    expect(() => localVisitUtc("2028-03-26", "01:30", "Europe/Lisbon")).toThrow(
      "Skipped clock times",
    );
  });
  test("calendar property injection stays text and unicode folds at 75 UTF-8 octets", () => {
    expect(escapeCalendarText("x\r\nBEGIN:VEVENT;test,\\")).toBe("x\\nBEGIN:VEVENT\\;test\\,\\\\");
    const folded = foldCalendarLine(`SUMMARY:${"東😀é".repeat(30)}`);
    expect(folded.split("\r\n").every((line) => new TextEncoder().encode(line).length <= 75)).toBe(
      true,
    );
    expect(folded.replace(/\r\n /g, "")).toBe(`SUMMARY:${"東😀é".repeat(30)}`);
    const trip = datedTrip();
    trip.places[0]!.name = "Hostile\r\nEND:VEVENT\r\nBEGIN:VEVENT";
    const calendar = buildCalendar(trip);
    expect(calendar.match(/^BEGIN:VEVENT$/gm)?.length).toBe(trip.stops.length);
  });
  test("printable itinerary escapes markup and map links contain coordinates only", () => {
    const trip = datedTrip();
    trip.places[0]!.name = '<script>alert("x")</script>';
    const printable = buildPrintableTrip(trip);
    expect(printable).not.toContain("<script>");
    expect(printable).toContain("&lt;script&gt;");
    expect(printable).toContain("not a booking");
    expect(placeMapUrl(38.7, -9.1)).toBe(
      "https://www.google.com/maps/search/?api=1&query=38.7%2C-9.1",
    );
    expect(() => placeMapUrl(100, 0)).toThrow("invalid");
    expect(placeDirectionsUrl(38.7, -9.1)).toBe(
      "https://www.google.com/maps/dir/?api=1&destination=38.7%2C-9.1",
    );
  });
  test("embedded destination metadata drives export names and timezone", () => {
    const trip = datedTrip();
    const city = {
      id: "geocoded-new-york",
      name: "New York",
      country: "United States",
      lat: 40.7,
      lng: -74,
      timeZone: "America/New_York",
    };
    trip.brief.destinationId = city.id;
    trip.brief.destination = city;
    if (trip.route)
      trip.route.stays[0] = { id: "nyc-stay", destinationId: city.id, destination: city, days: 3 };
    expect(tripTitle(trip)).toBe("New York");
    expect(buildCalendar(trip)).toContain("DTSTART:20280228T143000Z");
    expect(buildPrintableTrip(trip)).toContain("America/New_York");
  });
});

test("entered transfer times export as a busy UTC window and appear in the printable plan", () => {
  const before = datedTrip();
  const route = structuredClone(before.route!);
  route.stays.push({ id: "porto", destinationId: "porto", days: 2 });
  route.transfers.push({
    id: "test-transfer",
    fromStayId: "lisbon",
    toStayId: "porto",
    mode: "train",
    timing: {
      source: "traveler",
      departure: { date: "2028-03-02", time: "09:00" },
      arrival: { date: "2028-03-02", time: "12:00" },
    },
  });
  const result = applyTripCommand(before, {
    id: "timed-route",
    baseVersion: before.version,
    operations: [{ type: "set-route", route }],
  });
  if (!result.ok) throw new Error(result.error.message);
  const transfer = buildCalendar(result.trip)
    .split("BEGIN:VEVENT")
    .find((event) => event.includes("test-transfer"))!;
  expect(transfer).toContain("DTSTART:20280302T090000Z");
  expect(transfer).toContain("DTEND:20280302T120000Z");
  expect(transfer).toContain("TRANSP:OPAQUE");
  expect(transfer).toContain("STATUS:TENTATIVE");
  expect(transfer.replace(/\r\n /g, "")).toContain("Times entered by traveler");
  expect(buildPrintableTrip(result.trip)).toContain("Reserved travel time");
  expect(buildPrintableTrip(result.trip)).toContain("2028-03-02 12:00 Europe/Lisbon");
});

test("planned lodging and day notes appear in private exports without turning into venue visits", () => {
  const trip = datedTrip();
  trip.days[0]!.note = "A quiet evening <for us>";
  trip.lodgings = [
    {
      stayId: "lisbon",
      candidate: {
        id: "fixture-stay",
        destinationId: "lisbon",
        name: "Synthetic lodging <fixture>",
        description: "No real property implied.",
        lat: 38.7,
        lng: -9.1,
        source: "qloo",
        taste: { queryId: "stay-query", rank: 49 },
      },
    },
  ];
  const calendar = buildCalendar(trip);
  expect(calendar).toContain("DTSTART;VALUE=DATE:20280228");
  expect(calendar).toContain("DTEND;VALUE=DATE:20280301");
  expect(calendar).toContain("Planned stay");
  expect(calendar).toContain("Not reserved");
  const printable = buildPrintableTrip(trip);
  expect(printable).toContain("A quiet evening &lt;for us&gt;");
  expect(printable).toContain("Synthetic lodging &lt;fixture&gt;");
  expect(trip.stops).toHaveLength(8);
});

test("a flexible route exports a printable plan but never a fabricated calendar", () => {
  const trip = datedTrip();
  const result = applyTripCommand(trip, {
    id: "clear-export-dates",
    baseVersion: trip.version,
    operations: [{ type: "set-route", route: { ...trip.route!, startDate: null } }],
  });
  if (!result.ok) throw new Error(result.error.message);
  expect(() => buildCalendar(result.trip)).toThrow("Set trip dates");
  expect(buildPrintableTrip(result.trip)).toContain("Dates open");
  expect(buildPrintableTrip(result.trip)).not.toContain("2028-02-28");
});
