import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";

function mapFixture() {
  const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const routed = applyTripCommand(initial, {
    id: "map-navigation-route",
    baseVersion: initial.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-05-10",
          stays: [
            { id: "lisbon-stay", destinationId: "lisbon", days: 1 },
            { id: "porto-stay", destinationId: "porto", days: 2 },
          ],
          transfers: [
            {
              id: "lisbon-porto",
              fromStayId: "lisbon-stay",
              toStayId: "porto-stay",
              mode: "train",
            },
          ],
        },
      },
    ],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  const result = applyTripCommand(routed.trip, {
    id: "map-navigation-own-pin",
    baseVersion: routed.trip.version,
    operations: [
      {
        type: "set-own-place",
        place: {
          id: "traveler:day-map-porto",
          destinationId: "porto",
          name: "Porto pin navigation fixture",
          description: "Synthetic traveler-entered navigation fixture.",
          category: "cafe",
          lat: 41.15,
          lng: -8.62,
          source: "traveler",
          practical: { hours: "unknown", cost: "unknown" },
        },
      },
      {
        type: "add-stop",
        stop: {
          id: "porto-navigation-visit",
          dayId: "day-2",
          placeId: "traveler:day-map-porto",
          startTime: "15:00",
          durationMinutes: 45,
          pinned: false,
          timeLocked: false,
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.trip;
}

for (const width of [375, 1440]) {
  test(`a focused day opens its geographic map and returns to the selected timeline at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, mapFixture());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    const before = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 2 in Porto", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Map this day", exact: true }).click();
    const map = page.getByRole("region", { name: "Geographic day plan", exact: true });
    await expect(
      map.getByRole("heading", { name: "See where your day takes you.", exact: true }),
    ).toBeFocused();
    const context = map.getByRole("region", { name: "Mapped day", exact: true });
    await expect(context).toContainText("Day 2");
    await expect(context).toContainText("2028-05-11");
    await expect(context).toContainText("Porto");
    await expect(context).toContainText("Europe/Lisbon");
    const pin = map.getByRole("button", { name: /Porto pin navigation fixture/ });
    await expect(pin).toContainText("Traveler-added pin · location unverified");
    await pin.click();
    const detail = page.getByRole("complementary", {
      name: "Porto pin navigation fixture visit details",
      exact: true,
    });
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("Day 2");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(pin).toBeFocused();
    await map.getByRole("button", { name: "Zoom in", exact: true }).click();
    await map.getByRole("button", { name: "Open day timeline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 2 in Porto", exact: true })).toBeFocused();
    await expect(
      page.getByRole("button", { name: "Open Porto pin navigation fixture, 15:00", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Map this day", exact: true }).click();
    await page
      .getByRole("group", { name: "Trip day", exact: true })
      .getByRole("button", { name: "Day 3", exact: true })
      .click();
    await expect(context).toContainText("Day 3");
    await expect(context).toContainText("2028-05-12");
    const emptyCity = map.getByRole("application", {
      name: "City map of Porto with no visit pins",
      exact: true,
    });
    await expect(emptyCity).toBeVisible();
    await expect(emptyCity.locator(".leaflet-interactive")).toHaveCount(0);
    await expect(map.getByText("Your map starts with a place.", { exact: true })).toBeVisible();
    await map.getByRole("button", { name: "Open day timeline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 3 in Porto", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await page.getByRole("button", { name: "Map this day", exact: true }).click();
    await expect(context).toContainText("Day 1");
    await expect(context).toContainText("Lisbon");
    const sampleCity = map.getByRole("application", {
      name: "City map of Lisbon with no visit pins",
      exact: true,
    });
    await expect(sampleCity).toBeVisible();
    await expect(sampleCity.locator(".leaflet-interactive")).toHaveCount(0);
    await expect(
      map.getByText("A sample, with room for the real thing.", { exact: true }),
    ).toBeVisible();
    await map.getByRole("button", { name: "Open day timeline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeFocused();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
