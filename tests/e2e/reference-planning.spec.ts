import { expect, test } from "@playwright/test";
import {
  applyTripCommand,
  createDemoTrip,
  createTripFromPlaces,
  DEFAULT_BRIEF,
} from "../../packages/domain/src";

for (const width of [375, 1440]) {
  test(`the reference itinerary plans personal places on the selected city-day at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    const initial = createTripFromPlaces(DEFAULT_BRIEF, []);
    const routed = applyTripCommand(initial, {
      id: "reference-route-fixture",
      baseVersion: initial.version,
      operations: [
        {
          type: "set-route",
          route: {
            startDate: null,
            stays: [
              { id: "lisbon", destinationId: "lisbon", days: 2 },
              { id: "porto", destinationId: "porto", days: 2 },
            ],
            transfers: [{ id: "transfer", fromStayId: "lisbon", toStayId: "porto", mode: "train" }],
          },
        },
      ],
    });
    if (!routed.ok) throw new Error(routed.error.message);
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, routed.trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto(`/trip/${routed.trip.id}`);
    await page.getByRole("button", { name: /^Itinerary/ }).click();
    await page.getByRole("button", { name: "Add item to Day 4", exact: true }).click();
    const sheet = page.getByRole("region", { name: "Trip ideas", exact: true });
    await expect(sheet.getByLabel("Ideas day", { exact: true })).toHaveValue("day-4");
    const ideas = sheet.getByRole("region", { name: "Ideas and day notes", exact: true });
    await expect(
      ideas.getByRole("region", { name: "Day for these ideas", exact: true }),
    ).toContainText("Day 4 · Porto");
    await ideas.getByRole("button", { name: "Add a place I know", exact: true }).click();
    const own = page.getByRole("dialog", { name: "Add your own place and pin", exact: true });
    await own.getByLabel("Place name", { exact: true }).fill("Porto personal planning fixture");
    await own.getByRole("button", { name: "Use map center as pin", exact: true }).click();
    await own.getByRole("button", { name: "Keep as idea", exact: true }).click();
    await ideas.getByLabel("Idea visit start time", { exact: true }).fill("09:00");
    await ideas.getByLabel("Idea visit duration", { exact: true }).fill("30");
    const card = ideas.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Porto personal planning fixture", exact: true }),
    });
    await card.getByRole("button", { name: "Add to Day 4", exact: true }).click();
    await ideas.getByRole("button", { name: "Open added visit", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Adjust schedule", exact: true });
    await dialog.getByLabel("Visit start time", { exact: true }).fill("10:00");
    await dialog.getByRole("button", { name: "Update visit", exact: true }).click();
    await expect(dialog.getByRole("status").filter({ hasText: "Visit updated." })).toBeVisible();
    await dialog.getByLabel("Visit start time", { exact: true }).fill("10:30");
    await dialog.getByRole("button", { name: "Keep this time", exact: true }).click();
    await expect(dialog.getByLabel("Visit start time", { exact: true })).toHaveValue("10:30");
    await expect(dialog.getByRole("button", { name: "Update visit", exact: true })).toBeDisabled();
    await dialog
      .getByRole("button", { name: "Keep visit draft with latest plan", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Update visit", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("Unlock this visit");
    await dialog.getByRole("button", { name: "Time locked", exact: true }).click();
    await dialog
      .getByRole("button", { name: "Keep visit draft with latest plan", exact: true })
      .click();
    await dialog.getByRole("button", { name: "Update visit", exact: true }).click();
    await dialog.getByRole("button", { name: "Plan another visit", exact: true }).click();
    const anotherDay = dialog.getByLabel("Another visit day", { exact: true });
    await expect(anotherDay.getByRole("option")).toHaveCount(2);
    await anotherDay.selectOption("day-3");
    await dialog.getByLabel("Another visit start time", { exact: true }).fill("12:30");
    await dialog.getByLabel("Another visit duration", { exact: true }).fill("45");
    await dialog.getByRole("button", { name: "Add another visit", exact: true }).click();
    await expect(
      dialog.getByRole("status").filter({ hasText: "Another visit is on Day 3" }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    const saved = await read();
    expect(saved.places).toHaveLength(1);
    expect(saved.places[0]).toMatchObject({ destinationId: "porto", source: "traveler" });
    expect(saved.stops).toHaveLength(2);
    expect(saved.stops[0]).toMatchObject({
      dayId: "day-4",
      startTime: "10:30",
      durationMinutes: 30,
    });
    expect(saved.stops[1]).toMatchObject({
      dayId: "day-3",
      startTime: "12:30",
      durationMinutes: 45,
    });
    expect(saved.stops[0].id).not.toBe(saved.stops[1].id);
    await ideas.getByRole("button", { name: "Open day timeline", exact: true }).click();
    const itinerary = page.getByRole("region", { name: "Trip itinerary", exact: true });
    await expect(
      itinerary.getByRole("button", { name: "Porto personal planning fixture", exact: true }),
    ).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    expect((await read()).stops).toEqual(saved.stops);
    expect(errors).toEqual([]);
  });
}

for (const width of [375, 1440]) {
  test(`trip calendar opens the selected dated visit without losing its day at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 2 });
    const routed = applyTripCommand(initial, {
      id: "calendar-route-fixture",
      baseVersion: initial.version,
      operations: [
        {
          type: "set-route",
          route: {
            startDate: "2027-03-01",
            stays: [{ id: "lisbon", destinationId: "lisbon", days: 2 }],
            transfers: [],
          },
        },
      ],
    });
    if (!routed.ok) throw new Error(routed.error.message);
    const trip = routed.trip;
    const second = trip.stops.find((stop) => stop.dayId === "day-2")!;
    const place = trip.places.find((item) => item.id === second.placeId)!;
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, trip);
    await page.goto(`/trip/${trip.id}`);
    await page.getByRole("button", { name: /^Calendar/ }).click();
    const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
    await expect(calendar.getByLabel("Choose date", { exact: true })).toHaveValue("2027-03-01");
    await expect(calendar.getByLabel("Calendar view", { exact: true })).toHaveValue("Day");
    await calendar.getByRole("button", { name: "Next period", exact: true }).click();
    await calendar
      .getByRole("button", { name: `Open ${place.name} at ${second.startTime}`, exact: true })
      .click();
    const visit = page.getByRole("dialog", { name: "Adjust schedule", exact: true });
    await expect(visit.getByRole("heading", { name: place.name, exact: true })).toBeVisible();
    const form = visit.getByRole("form", { name: "Visit schedule", exact: true });
    await expect(form.getByRole("combobox")).toHaveValue("day-2");
    await form.getByLabel("Visit start time", { exact: true }).fill("08:00");
    await form.getByRole("button", { name: "Update visit", exact: true }).click();
    await expect(form.getByRole("status")).toContainText("Visit updated");
    await visit.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("region", { name: "Trip itinerary", exact: true })
      .getByRole("button", { name: "Close itinerary", exact: true })
      .click();
    await page.getByRole("button", { name: /^Calendar/ }).click();
    await expect(calendar.getByLabel("Choose date", { exact: true })).toHaveValue("2027-03-02");
    await expect(
      calendar.getByRole("button", { name: `Open ${place.name} at 08:00`, exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("an undated trip calendar keeps dates open and leads to date assignment", async ({ page }) => {
  const trip = createTripFromPlaces(DEFAULT_BRIEF, []);
  await page.addInitScript(
    (trip) => localStorage.setItem("tastip.trip.v1", JSON.stringify(trip)),
    trip,
  );
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: /^Calendar/ }).click();
  const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
  await expect(
    calendar.getByRole("heading", { name: "Your dates are still open", exact: true }),
  ).toBeVisible();
  await calendar.getByRole("button", { name: "Choose trip dates", exact: true }).click();
  const details = page.getByRole("dialog", { name: "Trip details", exact: true });
  await expect(details.getByRole("heading", { name: "Trip details", exact: true })).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  expect(stored.days.every((day: { date: string | null }) => day.date === null)).toBe(true);
});

for (const width of [375, 1440]) {
  test(`reference preferences update travelers and private planned costs without rebuilding at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const trip = createDemoTrip({
      ...DEFAULT_BRIEF,
      details: {
        request: "Private original brief",
        flexibleMonths: ["2027-03"],
        travelers: { adults: 2, children: 0, infants: 0, pets: 1 },
      },
    });
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, trip);
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto(`/trip/${trip.id}`);
    await page.getByRole("button", { name: /^Trip preferences/ }).click();
    const preferences = page.getByRole("dialog", { name: "Trip preferences", exact: true });
    const brief = preferences.getByRole("form", { name: "Trip brief", exact: true });
    await brief.getByLabel("Trip brief text", { exact: true }).fill("Revised private trip brief");
    const travelers = preferences.getByRole("form", {
      name: "Trip traveler categories",
      exact: true,
    });
    await travelers.getByLabel("Trip children", { exact: true }).fill("2");
    await travelers.getByRole("button", { name: "Update travelers", exact: true }).click();
    await expect(travelers.getByRole("status")).toContainText("Travelers updated");
    await expect(brief.getByLabel("Trip brief text", { exact: true })).toHaveValue(
      "Revised private trip brief",
    );
    await expect(
      brief.getByRole("button", { name: "Save trip brief", exact: true }),
    ).toBeDisabled();
    await brief
      .getByRole("button", { name: "Keep brief draft with latest plan", exact: true })
      .click();
    await brief.getByRole("button", { name: "Save trip brief", exact: true }).click();
    await expect(brief.getByRole("status")).toContainText("Trip brief saved");
    const details = preferences.getByRole("region", {
      name: "Travelers, pace and activity budget",
      exact: true,
    });
    await details.getByLabel("Trip pace", { exact: true }).selectOption("slow");
    await details.getByLabel("Trip activity budget", { exact: true }).fill("1200");
    await details.getByRole("button", { name: "Apply trip details", exact: true }).click();
    await expect(details.getByRole("status")).toContainText("Trip details updated");
    const updated = await read();
    expect(updated.id).toBe(trip.id);
    expect(updated.brief).toMatchObject({
      partySize: 4,
      pace: "slow",
      budget: 1200,
      details: {
        request: "Revised private trip brief",
        travelers: { adults: 2, children: 2, infants: 0, pets: 1 },
        flexibleMonths: ["2027-03"],
      },
    });
    expect(updated.stops).toEqual(trip.stops);
    await preferences.getByRole("button", { name: "Manage planned costs", exact: true }).click();
    const costs = page.getByRole("dialog", { name: "Planned costs", exact: true });
    const form = costs.getByRole("form", { name: "Add planned cost", exact: true });
    await form.getByLabel("Cost name", { exact: true }).fill("Private ticket fixture");
    await form.getByLabel("Unit amount", { exact: true }).fill("12.50");
    await form.getByLabel("Quantity", { exact: true }).fill("2");
    await form.getByLabel("Applies to", { exact: true }).selectOption("each-traveler");
    await form.getByRole("button", { name: "Add cost", exact: true }).click();
    const record = costs.getByRole("listitem", { name: "Private ticket fixture", exact: true });
    await expect(record).toContainText("100.00");
    const stored = await read();
    expect(stored.costs[0]).toMatchObject({
      unitAmountMinor: 1250,
      quantity: 2,
      appliesTo: "each-traveler",
      source: "traveler",
    });
    expect(stored.stops).toEqual(trip.stops);
    await costs.getByRole("button", { name: "Close", exact: true }).click();
    await page.reload();
    expect((await read()).brief).toEqual(stored.brief);
    expect((await read()).costs).toEqual(stored.costs);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("clearing a saved trip brief persists and remains undoable without changing the itinerary", async ({
  page,
}) => {
  const trip = createDemoTrip({
    ...DEFAULT_BRIEF,
    details: {
      request: "Keep this original private request",
      flexibleMonths: ["2027-03"],
      travelers: { adults: 2, children: 0, infants: 0, pets: 1 },
    },
  });
  await page.addInitScript((trip) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
  }, trip);
  const read = () =>
    page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: /^Trip preferences/ }).click();
  const preferences = page.getByRole("dialog", { name: "Trip preferences", exact: true });
  const brief = preferences.getByRole("form", { name: "Trip brief", exact: true });
  await brief.getByRole("button", { name: "Clear saved brief", exact: true }).click();
  await expect(brief.getByLabel("Trip brief text", { exact: true })).toHaveValue("");
  await expect(
    brief.getByRole("button", { name: "Clear saved brief", exact: true }),
  ).toBeDisabled();
  await page.reload();
  expect((await read()).brief.details.request).toBe("");
  await page.getByRole("button", { name: "More trip options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo last change", exact: true }).click();
  const restored = await read();
  expect(restored.brief).toEqual(trip.brief);
  expect(restored.stops).toEqual(trip.stops);
  expect(restored.days).toEqual(trip.days);
});
