import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";

function fixture() {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const result = applyTripCommand(trip, {
    id: "day-transfer-route",
    baseVersion: trip.version,
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
  if (!result.ok) throw new Error(result.error.message);
  return result.trip;
}

for (const width of [375, 1440]) {
  test(`arrival-day transfers open a shared time editor and retain accepted windows at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, fixture());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto("/studio");
    const before = await read();
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    await journey.getByRole("button", { name: "Day 1", exact: true }).click();
    const untimed = journey.getByRole("complementary", {
      name: "Travel times to decide",
      exact: true,
    });
    await expect(untimed).toHaveCount(0);
    await journey.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(untimed).toContainText("Lisbon → Porto · train planned");
    await expect(untimed).toContainText("Arrival day: 2028-05-11 · Europe/Lisbon");
    await expect(untimed).toContainText("No service schedule or reservation has been confirmed.");
    const add = untimed.getByRole("button", {
      name: "Add travel times from Lisbon to Porto",
      exact: true,
    });
    await add.click();
    const dialog = page.getByRole("dialog", { name: "Travel from Lisbon to Porto", exact: true });
    const departureDate = dialog.getByLabel("Departure date", { exact: true });
    await expect(departureDate).toBeFocused();
    await expect(departureDate).toHaveValue("2028-05-11");
    await dialog.getByLabel("Departure time", { exact: true }).fill("08:00");
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(add).toBeFocused();
    expect(await read()).toEqual(before);
    await add.click();
    await expect(dialog.getByLabel("Departure time", { exact: true })).toHaveValue("");
    await departureDate.fill("2028-05-10");
    await dialog.getByLabel("Departure time", { exact: true }).fill("17:30");
    await dialog.getByLabel("Arrival time", { exact: true }).fill("12:00");
    await dialog.getByRole("button", { name: "Save travel times", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "conflicts with your entered travel times",
    );
    await expect(dialog.getByLabel("Departure time", { exact: true })).toHaveValue("17:30");
    expect(await read()).toEqual(before);
    await departureDate.fill("2028-05-11");
    await dialog.getByLabel("Departure time", { exact: true }).fill("09:00");
    await dialog.getByRole("button", { name: "Save travel times", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(untimed).toHaveCount(0);
    const window = journey.getByRole("complementary", {
      name: "Reserved travel time",
      exact: true,
    });
    await expect(window).toContainText("180 min reserved");
    await expect(journey.locator(".day-timeline-summary")).toContainText("0m in visits");
    await expect(window).toContainText("2028-05-11 12:00 Europe/Lisbon");
    const edit = window.getByRole("button", {
      name: "Edit travel times from Lisbon to Porto",
      exact: true,
    });
    await expect(edit).toBeFocused();
    const saved = await read();
    expect(saved.stops).toEqual(before.stops);
    expect(saved.places).toEqual(before.places);
    expect(saved.days).toEqual(before.days);
    expect(saved.route.transfers[0].timing).toEqual({
      source: "traveler",
      departure: { date: "2028-05-11", time: "09:00" },
      arrival: { date: "2028-05-11", time: "12:00" },
    });
    await edit.click();
    await expect(dialog.getByLabel("Arrival time", { exact: true })).toHaveValue("12:00");
    await dialog.getByRole("button", { name: "Remove travel times", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(add).toBeFocused();
    await expect(window).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(window).toContainText("180 min reserved");
    await page.reload();
    await journey.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(window).toContainText("180 min reserved");
    expect((await read()).route).toEqual(saved.route);
    expect((await read()).stops).toEqual(before.stops);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
