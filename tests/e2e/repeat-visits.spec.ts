import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";
import type { Trip } from "../../packages/domain/src/types";

for (const width of [375, 1440]) {
  test(`repeat visits retain source identity while keeping schedules and notes separate at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = createDemoTrip(DEFAULT_BRIEF);
    const original = fixture.stops[0]!;
    const place = fixture.places.find((item) => item.id === original.placeId)!;
    place.name = "Repeat café contract fixture";
    place.source = "qloo";
    place.taste = { queryId: "older-place-query", rank: 12 };
    original.selection = { queryId: "accepted-visit-query", rank: 3 };
    original.note = "Private original reminder";
    original.pinned = true;
    original.timeLocked = true;
    fixture.stops = fixture.stops.filter((stop) => stop.dayId !== "day-3");
    const routed = applyTripCommand(fixture, {
      id: "repeat-route-fixture",
      baseVersion: fixture.version,
      operations: [
        {
          type: "set-route",
          route: {
            startDate: "2028-06-10",
            stays: [
              { id: "lisbon-stay", destinationId: "lisbon", days: 2 },
              { id: "porto-stay", destinationId: "porto", days: 1 },
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
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, routed.trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page
      .getByRole("button", { name: "Open Repeat café contract fixture, 09:30", exact: true })
      .click();
    const detail = page.getByRole("complementary", {
      name: "Repeat café contract fixture visit details",
      exact: true,
    });
    const repeat = detail.getByRole("region", { name: "Plan another visit", exact: true });
    await repeat.getByRole("button", { name: "Plan another visit", exact: true }).click();
    await expect(repeat.getByLabel("Another visit day", { exact: true })).toBeFocused();
    await expect(repeat.getByLabel("Another visit day", { exact: true })).toHaveValue("day-2");
    const suggestedTime = await repeat
      .getByLabel("Another visit start time", { exact: true })
      .inputValue();
    await expect(
      repeat.getByLabel("Another visit day", { exact: true }).locator("option[value=day-3]"),
    ).toHaveCount(0);
    await repeat.getByRole("button", { name: "Cancel another visit", exact: true }).click();
    await expect(
      repeat.getByRole("button", { name: "Plan another visit", exact: true }),
    ).toBeFocused();
    await repeat.getByRole("button", { name: "Plan another visit", exact: true }).click();
    await repeat.getByLabel("Another visit start time", { exact: true }).fill("11:15");
    await detail.getByRole("button", { name: "Time fixed", exact: true }).click();
    await expect(repeat.getByRole("status")).toContainText("Your plan changed");
    await expect(repeat.getByLabel("Another visit start time", { exact: true })).toHaveValue(
      "11:15",
    );
    await expect(
      repeat.getByRole("button", { name: "Add another visit", exact: true }),
    ).toBeDisabled();
    await detail.getByRole("button", { name: "Fix the time", exact: true }).click();
    const beforeReview = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    await repeat.getByRole("button", { name: "Reload suggested visit", exact: true }).click();
    await expect(repeat.getByLabel("Another visit day", { exact: true })).toBeFocused();
    await expect(repeat.getByLabel("Another visit start time", { exact: true })).toHaveValue(
      suggestedTime,
    );
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(beforeReview);
    await repeat.getByLabel("Another visit start time", { exact: true }).fill("11:15");
    await repeat.getByLabel("Another visit duration", { exact: true }).fill("75");
    await detail.getByRole("button", { name: "More like this", exact: true }).click();
    await detail.getByRole("button", { name: "More like this", exact: true }).click();
    await expect(
      repeat.getByRole("button", { name: "Add another visit", exact: true }),
    ).toBeDisabled();
    const beforeKeep = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    await repeat.getByRole("button", { name: "Keep these visit choices", exact: true }).click();
    await expect(repeat.getByLabel("Another visit day", { exact: true })).toBeFocused();
    await expect(repeat.getByLabel("Another visit start time", { exact: true })).toHaveValue(
      "11:15",
    );
    await expect(repeat.getByLabel("Another visit day", { exact: true })).toHaveValue("day-2");
    await expect(repeat.getByLabel("Another visit duration", { exact: true })).toHaveValue("75");
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(beforeKeep);
    await repeat.getByLabel("Another visit start time", { exact: true }).fill("10:00");
    await repeat.getByRole("button", { name: "Add another visit", exact: true }).click();
    await expect(repeat.getByRole("alert")).toContainText("These visits overlap");
    await expect(repeat.getByRole("alert")).toBeFocused();
    await expect(repeat.getByLabel("Another visit start time", { exact: true })).toHaveValue(
      "10:00",
    );
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(beforeKeep);
    await repeat.getByLabel("Another visit start time", { exact: true }).fill("11:00");
    await repeat.getByLabel("Another visit duration", { exact: true }).fill("45");
    await repeat.getByRole("button", { name: "Add another visit", exact: true }).click();
    await expect(repeat.getByRole("status")).toHaveText("Another visit is on Day 2 at 11:00.");
    const accepted: Trip = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    expect(accepted.stops.find((stop) => stop.id === original.id)).toEqual(original);
    const second = accepted.stops.find(
      (stop) => stop.placeId === place.id && stop.id !== original.id,
    )!;
    expect(second).toMatchObject({
      dayId: "day-2",
      startTime: "11:00",
      durationMinutes: 45,
      pinned: false,
      timeLocked: false,
      selection: original.selection,
    });
    expect(second.note).toBeUndefined();
    expect(second.feedback).toBeUndefined();
    expect(accepted.places.find((item) => item.id === place.id)?.taste).toEqual(place.taste);
    await repeat.getByRole("button", { name: "Open the new visit", exact: true }).click();
    await expect(detail.getByLabel("Visit start time", { exact: true })).toHaveValue("11:00");
    await expect(
      detail.getByRole("button", { name: "Keep this place", exact: true }),
    ).toBeVisible();
    await expect(
      detail.getByRole("button", { name: "Add a private note", exact: true }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Repeat café contract fixture, 11:00", exact: true }),
    ).toBeFocused();
    await page.reload();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(page.getByRole("button", { name: /Repeat café contract fixture/ })).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("button", { name: /Repeat café contract fixture/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page.getByRole("button", { name: /Repeat café contract fixture/ }).click();
    await expect(detail.getByRole("button", { name: "Place pinned", exact: true })).toBeVisible();
    await expect(detail.getByRole("button", { name: "Time fixed", exact: true })).toBeVisible();
    await expect(detail.getByText("Private original reminder", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
