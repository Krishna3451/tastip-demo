import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`floating days focus into a readable timeline and return at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    const journey = page.getByRole("region", { name: "Your floating day journey" });
    await expect(
      journey.getByRole("heading", { name: "Every day, its own island." }),
    ).toBeVisible();
    await expect(journey.getByRole("group", { name: "Choose a day to explore" })).toBeVisible();
    await journey.getByRole("button", { name: "Day 1", exact: true }).click();
    await expect(journey.getByRole("heading", { name: "Day 1 in Lisbon" })).toBeFocused();
    const dayOne = journey.getByRole("list", { name: "Day 1 timeline" });
    await expect(
      dayOne.getByRole("button", { name: /Open Demo · Slow Morning Café/ }),
    ).toBeVisible();
    await expect(dayOne).toContainText("9:30 AM");
    await expect(dayOne).toContainText("10:30 AM");
    await expect(dayOne).toContainText("Fictional sample place");
    await dayOne.getByRole("button", { name: /Open Demo · Slow Morning Café/ }).click();
    await expect(
      page.getByRole("heading", { name: "Demo · Slow Morning Café", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close visit details" }).click();
    await journey.getByRole("button", { name: "All days", exact: true }).click();
    await expect(
      journey.getByRole("heading", { name: "Every day, its own island." }),
    ).toBeFocused();
    await journey.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(journey.getByRole("heading", { name: "Day 2 in Lisbon" })).toBeFocused();
    const dayTwo = journey.getByRole("list", { name: "Day 2 timeline" });
    await expect(dayTwo.getByRole("button", { name: /Open Demo · Hilltop Garden/ })).toBeVisible();
    await expect(
      journey.getByRole("button", { name: /Open Demo · Slow Morning Café/ }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const description = dayTwo.locator(".day-timeline-description").first();
    expect(
      await description.evaluate((element) =>
        Number.parseFloat(getComputedStyle(element).fontSize),
      ),
    ).toBeGreaterThanOrEqual(12);
    expect(errors).toEqual([]);
  });
}

test("day islands remain navigable when WebGL is unavailable", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  const journey = page.getByRole("region", { name: "Your floating day journey" });
  await expect(journey.getByText("Your days are ready to explore.")).toBeVisible();
  await journey.getByRole("button", { name: "Day 1", exact: true }).click();
  await expect(journey.getByRole("heading", { name: "Day 1 in Lisbon" })).toBeVisible();
  await expect(journey.getByRole("list", { name: "Day 1 timeline" })).toContainText(
    "Demo · Slow Morning Café",
  );
  await journey.getByRole("button", { name: "Next day", exact: true }).click();
  await expect(journey.getByRole("heading", { name: "Day 2 in Lisbon" })).toBeVisible();
});
