import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`route and travel-time drafts survive newer edits and reset on explicit reopen at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByLabel("Number of days", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    const originalStops = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops,
    );
    const route = page.getByRole("region", { name: "Dates and city route", exact: true });
    const createRoute = async () => {
      await route.getByLabel("Trip start date", { exact: true }).fill("2028-06-10");
      await route.getByRole("button", { name: "Add city", exact: true }).click();
      await route.getByLabel("City 2", { exact: true }).selectOption("porto");
      await route.getByLabel("Transport to city 2", { exact: true }).selectOption("train");
      await route.getByRole("button", { name: "Save route", exact: true }).click();
    };
    await route.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await createRoute();
    await route.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await route.getByLabel("Trip start date", { exact: true }).fill("2028-07-01");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(route.getByLabel("Trip start date", { exact: true })).toHaveValue("2028-07-01");
    await expect(route.getByRole("status")).toContainText("Your route draft is still here");
    await expect(route.getByRole("button", { name: "Save route", exact: true })).toBeDisabled();
    await route.getByRole("button", { name: "Reload latest route", exact: true }).click();
    await expect(route.getByLabel("Trip start date", { exact: true })).toHaveValue("");
    await expect(route.getByLabel("Trip start date", { exact: true })).toBeFocused();
    await expect(route.getByLabel("City 2", { exact: true })).toHaveCount(0);
    await createRoute();
    await route.locator("summary").filter({ hasText: "Travel between cities" }).click();
    const times = route.getByRole("form", { name: "Travel times 1", exact: true });
    const departure = times.getByLabel("Departure time", { exact: true });
    const arrival = times.getByLabel("Arrival time", { exact: true });
    const saveTimes = times.getByRole("button", { name: "Save travel times", exact: true });
    await departure.fill("09:00");
    await arrival.fill("11:30");
    await saveTimes.click();
    await expect(times.getByRole("status")).toContainText("Travel times updated");
    await expect(saveTimes).toBeDisabled();
    await departure.fill("10:30");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(departure).toHaveValue("10:30");
    await expect(arrival).toHaveValue("11:30");
    await expect(times.getByRole("status")).toContainText("Your entered times are still here");
    await expect(saveTimes).toBeDisabled();
    await times.getByRole("button", { name: "Reload latest travel times", exact: true }).click();
    await expect(departure).toHaveValue("");
    await expect(arrival).toHaveValue("");
    await expect(times.getByLabel("Departure date", { exact: true })).toBeFocused();
    await departure.fill("10:00");
    await arrival.fill("12:00");
    await saveTimes.click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(departure).toHaveValue("");
    await expect(arrival).toHaveValue("");
    await expect(times.getByRole("status")).toHaveCount(0);
    await departure.fill("11:00");
    await arrival.fill("12:30");
    await saveTimes.click();
    await expect(
      route.locator("summary").filter({ hasText: "Travel between cities" }),
    ).toContainText("1 of 1 timed");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("saved");
    else await page.getByRole("button", { name: "Saved trips", exact: true }).click();
    const library = page.getByRole("region", { name: "Saved trips", exact: true });
    await library.getByRole("button", { name: "Save current trip", exact: true }).click();
    await expect(library.getByRole("status")).toContainText("Saved to this browser");
    const version = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").version,
    );
    await route.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await route.getByLabel("Trip start date", { exact: true }).fill("2028-07-04");
    await library
      .getByRole("button", { name: "Open saved Lisbon → Porto trip", exact: true })
      .click();
    await expect(
      route.getByRole("button", { name: "Edit dates & cities", exact: true }),
    ).toBeVisible();
    await expect(route.getByLabel("Trip start date", { exact: true })).toHaveCount(0);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").version,
      ),
    ).toBe(version);
    await route.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await expect(route.getByLabel("Trip start date", { exact: true })).toHaveValue("2028-06-10");
    await expect(route.getByRole("button", { name: "Save route", exact: true })).toBeDisabled();
    await route.getByRole("button", { name: "Cancel route changes", exact: true }).click();
    await route.locator("summary").filter({ hasText: "Travel between cities" }).click();
    await expect(departure).toHaveValue("11:00");
    await expect(arrival).toHaveValue("12:30");
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops),
    ).toEqual(originalStops);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
