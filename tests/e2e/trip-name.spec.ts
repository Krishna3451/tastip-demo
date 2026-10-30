import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`trip naming keeps focus, undo, saved copies and reload consistent at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await page.getByRole("button", { name: "Name this trip", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Give this journey a name.", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Trip name", exact: true })).toBeFocused();
    await dialog.getByRole("textbox", { name: "Trip name", exact: true }).fill("Lisbon, slowly");
    await dialog.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lisbon, slowly");
    await expect(page.getByRole("button", { name: "Edit trip name", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("at your own pace");
    await page.getByRole("button", { name: "Name this trip", exact: true }).click();
    const longName = "A".repeat(120);
    await dialog.getByRole("textbox", { name: "Trip name", exact: true }).fill(longName);
    await dialog.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(longName);
    const titleBounds = await page.getByRole("heading", { level: 1 }).boundingBox();
    expect(titleBounds?.height).toBeLessThan(width <= 620 ? 70 : 100);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Edit trip name", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Trip name", exact: true }).fill("Lisbon weekend");
    await dialog.getByRole("button", { name: "Save name", exact: true }).click();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lisbon weekend");
    await page.getByRole("button", { name: "Edit trip name", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Trip name", exact: true }).fill("Unsaved name");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lisbon weekend");
    await expect(page.getByRole("button", { name: "Edit trip name", exact: true })).toBeFocused();
    if (width <= 620) await page.getByLabel("More planning views").selectOption("saved");
    else await page.getByRole("button", { name: "Saved trips", exact: true }).click();
    const library = page.getByRole("region", { name: "Saved trips", exact: true });
    await library.getByRole("button", { name: "Save current trip", exact: true }).click();
    await expect(
      library.getByRole("heading", { name: "Lisbon weekend", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "New trip", exact: true }).click();
    await page.getByRole("button", { name: "Saved trips", exact: true }).click();
    await page.getByRole("button", { name: "Open saved Lisbon weekend trip", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lisbon weekend");
    await page.getByRole("button", { name: "Edit trip name", exact: true }).click();
    await dialog.getByRole("button", { name: "Use city names", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("at your own pace");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Lisbon weekend");
  });
}
