import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`day timelines show the correct city-night lodging and open its stay at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByLabel("Number of days", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    const stops = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops,
    );
    await page.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await page.getByLabel("Trip start date", { exact: true }).fill("2028-05-10");
    await page.getByRole("button", { name: "Add city", exact: true }).click();
    await page.getByLabel("City 2", { exact: true }).selectOption("porto");
    await page.getByLabel("Days in city 2", { exact: true }).fill("2");
    await page.getByRole("button", { name: "Save route", exact: true }).click();
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    const night = page.getByRole("region", { name: "Lodging for this night", exact: true });
    await expect(night).toContainText("NIGHT OF 2028-05-11 · Porto");
    await expect(night).toContainText("No lodging idea saved");
    await night.getByRole("button", { name: "Choose lodging in Porto", exact: true }).click();
    const stays = page.getByRole("region", { name: "Planned stays", exact: true });
    const city = stays.getByLabel("Lodging city stay", { exact: true });
    await expect(
      stays.getByRole("heading", { name: "A good night, in your kind of place.", exact: true }),
    ).toBeFocused();
    await expect(city.locator("option:checked")).toHaveText("Porto · 1 night");
    const portoName = `Porto ${"P".repeat(180)}`;
    const saveOwn = async (name: string) => {
      await stays.locator("summary").filter({ hasText: "Add lodging you’ve found" }).click();
      const form = stays.getByRole("form", { name: "Your lodging idea", exact: true });
      await form.getByLabel("Lodging name", { exact: true }).fill(name);
      await form
        .getByRole("textbox", { name: /^Property or booking link/ })
        .fill("https://example.test/lodging");
      await form.getByRole("button", { name: "Save my lodging idea", exact: true }).click();
    };
    await saveOwn(portoName);
    await city.selectOption({ index: 0 });
    await expect(city.locator("option:checked")).toHaveText("Lisbon · 1 night");
    await saveOwn("Lisbon traveler idea");
    const openDay = async (day: string) => {
      await page.getByRole("button", { name: "Journey", exact: true }).click();
      await page.getByRole("button", { name: day, exact: true }).click();
    };
    await openDay("Day 2");
    await expect(night).toContainText(portoName);
    await expect(night).toContainText("Entered by you · details unverified");
    await expect(night).toContainText("Idea only; not reserved");
    await expect(
      night.getByRole("link", { name: "Open property link ↗", exact: true }),
    ).toHaveAttribute("href", "https://example.test/lodging");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await night.getByRole("button", { name: "Review lodging in Porto", exact: true }).click();
    await expect(city.locator("option:checked")).toHaveText("Porto · 1 night");
    await stays
      .locator(".planned-lodgings article")
      .filter({ hasText: portoName })
      .getByRole("button", { name: "Remove lodging idea", exact: true })
      .click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await openDay("Day 3");
    await expect(night).toHaveCount(0);
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await expect(night).toContainText(portoName);
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await expect(night).toContainText("NIGHT OF 2028-05-10 · Lisbon");
    await expect(night).toContainText("Lisbon traveler idea");
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops),
    ).toEqual(stops);
    await page.reload();
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(night).toContainText(portoName);
    expect(errors).toEqual([]);
  });
}
