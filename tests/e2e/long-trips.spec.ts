import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`thirty-day routes stay readable through island groups, calendar and reload at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/studio");
    await page.getByLabel("Number of days").fill("30");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await page.getByRole("button", { name: "Edit dates & cities" }).click();
    await page.getByLabel("Trip start date").fill("2028-02-20");
    await page.getByLabel("Days in city 1").fill("15");
    await page.getByRole("button", { name: "Add city", exact: true }).click();
    await page.getByLabel("City 2", { exact: true }).selectOption("porto");
    await page.getByLabel("Days in city 2").fill("15");
    await page.getByRole("button", { name: "Save route", exact: true }).click();
    const journey = page.getByRole("region", { name: "Your floating day journey" });
    const groups = journey.getByRole("navigation", { name: "Journey day groups" });
    await expect(groups.getByRole("status")).toHaveText("Days 1–7 of 30");
    for (let group = 0; group < 4; group++)
      await groups.getByRole("button", { name: "Later days" }).click();
    await expect(groups.getByRole("status")).toHaveText("Days 29–30 of 30");
    await expect(groups.getByRole("button", { name: "Later days" })).toBeDisabled();
    await journey.getByRole("button", { name: "Day 30", exact: true }).click();
    await expect(journey.getByRole("heading", { name: "Day 30 in Porto" })).toBeFocused();
    await journey.getByRole("button", { name: "Previous day", exact: true }).click();
    await expect(journey.getByRole("heading", { name: "Day 29 in Porto" })).toBeFocused();
    await journey.getByRole("button", { name: "All days", exact: true }).click();
    await expect(groups.getByRole("status")).toHaveText("Days 29–30 of 30");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width < 600) await page.getByLabel("More planning views").selectOption("calendar");
    else await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(
      page
        .getByRole("region", { name: "Trip calendar" })
        .getByRole("button", { name: /Day 30 Mar 20 Porto/ }),
    ).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Edit dates & cities" }).click();
    await expect(page.getByLabel("Days in city 1")).toHaveValue("15");
    await expect(page.getByLabel("Days in city 2")).toHaveValue("15");
  });
}
