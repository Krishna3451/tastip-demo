import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src";

for (const width of [375, 1440]) {
  test(`focused day navigation supports keyboard selection without editing the trip at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 3 });
    await page.addInitScript((value) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(value));
    }, trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    const overview = journey.getByRole("group", { name: "Choose a day to explore", exact: true });
    await expect(overview).toBeVisible();
    const accepted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    await overview.getByRole("button", { name: "Day 1", exact: true }).click();
    await expect(
      journey.getByRole("heading", { name: "Day 1 in Lisbon", exact: true }),
    ).toBeFocused();

    const navigation = journey.getByRole("navigation", { name: "Choose another day", exact: true });
    const first = navigation.getByRole("button", {
      name: "Open Day 1 schedule in Lisbon",
      exact: true,
    });
    const second = navigation.getByRole("button", {
      name: "Open Day 2 schedule in Lisbon",
      exact: true,
    });
    const last = navigation.getByRole("button", {
      name: "Open Day 3 schedule in Lisbon",
      exact: true,
    });
    await expect(first).toHaveAttribute("aria-current", "step");
    await first.focus();
    await first.press("ArrowLeft");
    await expect(first).toBeFocused();
    await first.press("ArrowRight");
    await expect(second).toBeFocused();
    // Arrow keys move focus for inspection; Enter is the explicit day selection.
    await expect(first).toHaveAttribute("aria-current", "step");
    await expect(second).not.toHaveAttribute("aria-current", "step");
    await expect(journey.getByRole("list", { name: "Day 1 timeline", exact: true })).toBeVisible();
    await second.press("End");
    await expect(last).toBeFocused();
    await last.press("ArrowRight");
    await expect(last).toBeFocused();
    await last.press("Home");
    await expect(first).toBeFocused();
    await first.press("ArrowRight");
    await second.press("Enter");
    await expect(
      journey.getByRole("heading", { name: "Day 2 in Lisbon", exact: true }),
    ).toBeFocused();
    await expect(second).toHaveAttribute("aria-current", "step");
    await expect(first).not.toHaveAttribute("aria-current", "step");
    await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toBeVisible();
    await expect(journey.getByRole("list", { name: "Day 1 timeline", exact: true })).toHaveCount(0);

    await journey.getByRole("button", { name: "All days", exact: true }).click();
    await expect(
      journey.getByRole("heading", { name: "Every day, its own island.", exact: true }),
    ).toBeFocused();
    // Existing exact day-button names remain unique when the overview returns.
    await expect(journey.getByRole("button", { name: "Day 2", exact: true })).toHaveCount(1);
    await expect(overview.getByRole("button", { name: "Day 2", exact: true })).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(accepted);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
