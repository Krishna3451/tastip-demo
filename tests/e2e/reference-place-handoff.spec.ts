import { expect, test } from "@playwright/test";
import {
  applyTripCommand,
  createDemoTrip,
  createTripFromPlaces,
  DEFAULT_BRIEF,
  DESTINATIONS,
  type Place,
} from "../../packages/domain/src";

const savedPlace: Place = {
  id: "qloo-saved-place-fixture",
  destinationId: "lisbon",
  name: "Saved Qloo scheduling fixture",
  category: "culture",
  description: "Synthetic saved candidate for the browser contract.",
  lat: 38.7223,
  lng: -9.1393,
  source: "qloo",
  taste: { queryId: "saved-query-fixture", rank: 7, score: 0.42 },
  practical: { hours: "unknown", cost: "unknown" },
};

for (const width of [375, 1440]) {
  test(`a saved candidate is scheduled with its evidence and reopens the accepted visit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 2 }, []);
    await page.addInitScript(
      ({ trip, place, destination }) => {
        if (!localStorage.getItem("tastip.trip.v1"))
          localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
        if (!localStorage.getItem("tastip.reference.saved:guest"))
          localStorage.setItem(
            "tastip.reference.saved:guest",
            JSON.stringify([{ place, destination }]),
          );
      },
      { trip, place: savedPlace, destination: DESTINATIONS[0]! },
    );
    await page.goto("/saved");
    await page
      .getByRole("navigation", { name: "Saved views", exact: true })
      .getByRole("button", { name: /^Places/ })
      .click();
    await page.getByRole("button", { name: `View ${savedPlace.name}`, exact: true }).click();
    const venue = page.getByRole("dialog", { name: savedPlace.name, exact: true });
    await venue.getByRole("button", { name: "Add to trip", exact: true }).click();
    const add = page.getByRole("dialog", { name: "Add place to trip", exact: true });
    await add.getByLabel("Place visit day", { exact: true }).selectOption("day-2");
    await add.getByLabel("Place visit start time", { exact: true }).fill("11:15");
    await add.getByLabel("Place visit duration", { exact: true }).fill("45");
    await add.getByRole("button", { name: "Add visit", exact: true }).click();
    const visit = page.getByRole("dialog", { name: "Adjust schedule", exact: true });
    await expect(visit.getByRole("heading", { name: savedPlace.name, exact: true })).toBeVisible();
    await expect(visit.getByLabel("Visit start time", { exact: true })).toHaveValue("11:15");
    await expect(page).toHaveURL(/\/trip\/[^?]+\?view=itinerary&day=day-2&visit=/);
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    expect(stored.places).toHaveLength(1);
    expect(stored.places[0].taste).toEqual(savedPlace.taste);
    expect(stored.stops).toHaveLength(1);
    expect(stored.stops[0]).toMatchObject({
      placeId: savedPlace.id,
      dayId: "day-2",
      startTime: "11:15",
      durationMinutes: 45,
      selection: savedPlace.taste,
    });
    await page.reload();
    await expect(visit.getByRole("heading", { name: savedPlace.name, exact: true })).toBeVisible();
    await expect(visit.getByLabel("Visit start time", { exact: true })).toHaveValue("11:15");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("a rejected saved-place visit does not import a candidate or change the accepted trip", async ({
  page,
}) => {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  await page.addInitScript(
    ({ trip, place, destination }) => {
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      localStorage.setItem(
        "tastip.reference.saved:guest",
        JSON.stringify([{ place, destination }]),
      );
    },
    { trip, place: savedPlace, destination: DESTINATIONS[0]! },
  );
  await page.goto("/saved");
  await page
    .getByRole("navigation", { name: "Saved views", exact: true })
    .getByRole("button", { name: /^Places/ })
    .click();
  await page.getByRole("button", { name: `Add ${savedPlace.name} to trip`, exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add place to trip", exact: true });
  await add.getByLabel("Place visit start time", { exact: true }).fill("09:30");
  await add.getByRole("button", { name: "Add visit", exact: true }).click();
  await expect(add.getByRole("alert")).toBeVisible();
  await expect(add.getByLabel("Place visit start time", { exact: true })).toHaveValue("09:30");
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  expect(stored).toEqual(trip);
});

test("the global calendar carries its selected visit across navigation and reload", async ({
  page,
}) => {
  const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 2 });
  const result = applyTripCommand(initial, {
    id: "global-calendar-fixture",
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
  if (!result.ok) throw new Error(result.error.message);
  const trip = result.trip;
  const stop = trip.stops.find((stop) => stop.dayId === "day-2")!;
  const place = trip.places.find((item) => item.id === stop.placeId)!;
  await page.addInitScript((trip) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
  }, trip);
  await page.goto("/calendar");
  await page.getByLabel("Choose date", { exact: true }).fill("2027-03-02");
  await page
    .getByRole("button", { name: `Open ${place.name} at ${stop.startTime}`, exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/trip/${trip.id}\\?view=itinerary&day=day-2&visit=`));
  const visit = page.getByRole("dialog", { name: "Adjust schedule", exact: true });
  await expect(visit.getByRole("heading", { name: place.name, exact: true })).toBeVisible();
  await expect(
    visit.getByRole("form", { name: "Visit schedule", exact: true }).getByRole("combobox"),
  ).toHaveValue("day-2");
  await page.reload();
  await expect(visit.getByRole("heading", { name: place.name, exact: true })).toBeVisible();
  expect(
    (await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"))).stops,
  ).toEqual(trip.stops);
});

test("a session change closes place dialogs from the previous owner", async ({ page }) => {
  const alice = { id: "00000000-0000-4000-8000-000000000001", username: "fixture-alice" };
  const bob = { id: "00000000-0000-4000-8000-000000000002", username: "fixture-bob" };
  let account = alice;
  await page.route("**/api/account", (route) => route.fulfill({ json: { account } }));
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const place = trip.places[0]!;
  place.name = "Private Alice place fixture";
  await page.addInitScript(
    ({ trip, owner }) => localStorage.setItem(`tastip.trip.v1:${owner}`, JSON.stringify(trip)),
    { trip, owner: alice.id },
  );
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: /^Itinerary/ }).click();
  await page.getByRole("button", { name: `View ${place.name}`, exact: true }).click();
  const venue = page.getByRole("dialog", { name: place.name, exact: true });
  await expect(venue).toBeVisible();
  await venue.getByRole("button", { name: "Plan another visit", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Add place to trip", exact: true })).toBeVisible();
  account = bob;
  await page.evaluate(() =>
    window.dispatchEvent(new StorageEvent("storage", { key: "tastip.session.change.v1" })),
  );
  await expect(
    page.getByRole("button", { name: `${bob.username} Menu`, exact: true }),
  ).toBeVisible();
  await expect(venue).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Add place to trip", exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => localStorage.getItem("tastip.trip.v1:00000000-0000-4000-8000-000000000002") ?? "",
    ),
  ).not.toContain(place.name);
});
