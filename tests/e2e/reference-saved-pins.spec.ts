import { expect, test } from "@playwright/test";
import {
  applyTripCommand,
  createDemoTrip,
  createTripFromPlaces,
  DEFAULT_BRIEF,
  type Destination,
  type OwnPlace,
} from "../../packages/domain/src";

const destination: Destination = {
  id: "saved-pin-fixture-city",
  name: "Synthetic saved-pin city",
  country: "Test fixture",
  lat: 52.52,
  lng: 13.405,
  timeZone: "Europe/Berlin",
};
const pin: OwnPlace = {
  id: "traveler:saved-pin-fixture",
  destinationId: destination.id,
  name: "Synthetic private saved pin",
  category: "culture",
  description: "Fixture place entered by the traveler, not a provider recommendation.",
  lat: 52.521,
  lng: 13.406,
  source: "traveler",
  practical: { hours: "unknown", cost: "unknown" },
};

for (const scope of ["guest", "account"] as const) {
  test(`${scope === "account" ? "An account" : "A guest"} personal pin can be saved and reopened after reload with its custom destination`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 900 });
    const account =
      scope === "account"
        ? { id: "00000000-0000-4000-8000-000000000019", username: "saved-pin-fixture" }
        : null;
    await page.route("**/api/account", (route) => route.fulfill({ json: { account } }));
    if (account) {
      let copy: { workspace: unknown; revision: number; updatedAt: number | null } = {
        workspace: null,
        revision: 0,
        updatedAt: null,
      };
      await page.route("**/api/saved", async (route) => {
        if (route.request().method() === "POST") {
          const body = route.request().postDataJSON();
          if (body.expectedRevision !== copy.revision) {
            await route.fulfill({
              status: 409,
              json: { error: { message: "Synthetic Saved conflict" } },
            });
            return;
          }
          copy = { workspace: body.workspace, revision: copy.revision + 1, updatedAt: 1 };
        }
        await route.fulfill({ json: copy });
      });
    }

    const initial = createTripFromPlaces(
      { ...DEFAULT_BRIEF, destinationId: destination.id, destination, days: 1 },
      [],
    );
    const result = applyTripCommand(initial, {
      id: "saved-pin-browser-fixture",
      baseVersion: initial.version,
      operations: [
        { type: "set-own-place", place: pin },
        {
          type: "add-stop",
          stop: {
            id: "saved-pin-fixture-visit",
            placeId: pin.id,
            dayId: "day-1",
            startTime: "10:00",
            durationMinutes: 60,
            pinned: false,
            timeLocked: false,
          },
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    const trip = result.trip;
    const owner = account?.id ?? "guest";
    const savedKey = `tastip.reference.saved:${owner}`;
    const otherKey = `tastip.reference.saved:${scope === "guest" ? "00000000-0000-4000-8000-000000000019" : "guest"}`;
    await page.addInitScript(
      ({ trip, account, otherKey }) => {
        const tripKey = account ? `tastip.trip.v1:${account.id}` : "tastip.trip.v1";
        if (!localStorage.getItem(tripKey)) localStorage.setItem(tripKey, JSON.stringify(trip));
        if (!localStorage.getItem(otherKey)) localStorage.setItem(otherKey, "[]");
      },
      { trip, account, otherKey },
    );
    await page.goto(`/trip/${trip.id}`);
    await page.getByRole("button", { name: /^Itinerary/ }).click();
    await page.getByRole("button", { name: `View ${pin.name}`, exact: true }).click();
    const venue = page.getByRole("dialog", { name: pin.name, exact: true });
    await expect(venue).toContainText("Your place · details entered by you");
    await venue.getByRole("button", { name: "Save", exact: true }).click();
    await expect(venue.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), savedKey),
    ).toEqual([{ place: pin, destination }]);
    await page.goto("/saved");
    await page
      .getByRole("navigation", { name: "Saved views", exact: true })
      .getByRole("button", { name: /^Places/ })
      .click();
    await expect(page.getByRole("button", { name: `View ${pin.name}`, exact: true })).toBeVisible();
    await page.reload();
    await page
      .getByRole("navigation", { name: "Saved views", exact: true })
      .getByRole("button", { name: /^Places/ })
      .click();
    await page.getByRole("button", { name: `View ${pin.name}`, exact: true }).click();
    await expect(venue).toContainText("Your place · details entered by you");
    await expect(venue.getByRole("button", { name: "Saved", exact: true })).toBeVisible();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), savedKey),
    ).toEqual([{ place: pin, destination }]);
    expect(await page.evaluate((key) => localStorage.getItem(key), otherKey)).toBe("[]");
  });
}

test("malformed Saved data keeps its stored copy, blocks writes and does not hide a valid travel profile", async ({
  page,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const place = trip.places[0];
  if (!place) throw new Error("Missing demo place fixture.");
  const raw = JSON.stringify([
    { place: pin, destination },
    { place: { ...pin, id: "broken", source: "unknown" }, destination },
  ]);
  const profile = {
    firstName: "Valid profile fixture",
    lastName: "",
    city: destination,
    tripIdea: "",
    notes: "",
    loyalty: [],
    destinations: [],
    visited: [],
    companions: [],
    budget: [],
    splurges: [],
    lodging: [],
    restaurants: [],
    dietary: [],
    weekends: [],
  };
  await page.route("**/api/account", (route) => route.fulfill({ json: { account: null } }));
  await page.addInitScript(
    ({ trip, raw, profile }) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      if (!localStorage.getItem("tastip.reference.saved:guest"))
        localStorage.setItem("tastip.reference.saved:guest", raw);
      localStorage.setItem("tastip.reference.profile:guest", JSON.stringify(profile));
    },
    { trip, raw, profile },
  );
  await page.goto("/profile");
  await expect(page.getByRole("heading", { name: profile.firstName, exact: true })).toBeVisible();
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: /^Itinerary/ }).click();
  await page.getByRole("button", { name: `View ${place.name}`, exact: true }).click();
  const venue = page.getByRole("dialog", { name: place.name, exact: true });
  await venue.getByRole("button", { name: "Save", exact: true }).click();
  await expect(venue.getByRole("button", { name: "Save", exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem("tastip.reference.saved:guest"))).toBe(raw);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.profile:guest") ?? "null"),
    ),
  ).toEqual(profile);
});
