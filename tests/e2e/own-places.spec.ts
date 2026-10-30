import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("a phone draft can mix personal pins with clearly marked samples without overflowing", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 1000 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
  await page.goto("/studio");
  await page.getByLabel("Number of days", { exact: true }).fill("1");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByLabel("More planning views").selectOption("ideas");
  const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
  const add = ideas.getByRole("button", { name: "Add a place I know", exact: true });
  await add.click();
  const dialog = page.getByRole("dialog", { name: "Add your own place and pin", exact: true });
  await dialog
    .getByRole("textbox", { name: "Place name", exact: true })
    .fill("Canceled pin fixture");
  await dialog.getByRole("button", { name: "Use map center as pin", exact: true }).click();
  await expect(dialog.getByRole("status").filter({ hasText: "Your pin:" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(
    ideas.getByRole("heading", { name: "Canceled pin fixture", exact: true }),
  ).toHaveCount(0);
  await expect(add).toBeFocused();
  await add.click();
  await expect(dialog.getByRole("textbox", { name: "Place name", exact: true })).toHaveValue("");
  await dialog.getByRole("textbox", { name: "Place name", exact: true }).fill("Mixed pin fixture");
  await dialog.getByRole("button", { name: "Use map center as pin", exact: true }).click();
  await dialog.getByRole("button", { name: "Keep as idea", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator(".sample-badge")).toHaveText("Mixed draft");
  await expect(page.locator(".sample-badge")).toHaveAttribute("title", /fictional sample/);
  await expect(
    ideas
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Mixed pin fixture", exact: true }) }),
  ).toContainText("Added by you · pin unverified");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole("button", { name: "List", exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

for (const width of [375, 1440]) {
  test(`own pins become editable ideas and real map visits at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    // Offline map contract: coordinates remain usable without requesting real tiles.
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByLabel("Number of days", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Start a blank plan", exact: true }).click();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page.getByRole("button", { name: "Add to this day", exact: true }).click();
    const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
    await ideas.getByRole("button", { name: "Add a place I know", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add your own place and pin", exact: true });
    await dialog
      .getByRole("textbox", { name: "Place name", exact: true })
      .fill("Own riverside pin fixture");
    await dialog
      .getByRole("combobox", { name: "Kind of place", exact: true })
      .selectOption("outdoors");
    await dialog.getByRole("button", { name: "Keep as idea", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("choose a pin");
    await dialog.locator("summary").filter({ hasText: "Enter pin coordinates" }).click();
    await dialog.getByRole("spinbutton", { name: "Latitude", exact: true }).fill("40");
    await dialog.getByRole("spinbutton", { name: "Longitude", exact: true }).fill("-9.14");
    await dialog.getByRole("button", { name: "Keep as idea", exact: true }).click();
    await expect(dialog.getByRole("alert")).toContainText("within 50 km");
    await dialog.getByRole("spinbutton", { name: "Latitude", exact: true }).fill("38.72");
    await dialog.getByRole("button", { name: "Zoom in", exact: true }).click();
    await dialog.getByRole("button", { name: "Keep as idea", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(
      ideas.getByRole("button", { name: "Add a place I know", exact: true }),
    ).toBeFocused();
    const card = ideas.getByRole("article").filter({
      has: page.getByRole("heading", { name: "Own riverside pin fixture", exact: true }),
    });
    await expect(card).toContainText("Added by you · pin unverified");
    await expect(card).not.toContainText("Qloo #");
    await card.getByRole("button", { name: "Edit my place", exact: true }).click();
    const edit = page.getByRole("dialog", { name: "Edit your place and pin", exact: true });
    await edit
      .getByRole("textbox", { name: "Place name", exact: true })
      .fill("Corrected riverside pin");
    await edit.getByRole("button", { name: "Save my place", exact: true }).click();
    const corrected = ideas
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: "Corrected riverside pin", exact: true }) });
    await corrected
      .getByRole("button", { name: "Remove idea: Corrected riverside pin", exact: true })
      .click();
    await expect(corrected).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(corrected).toBeVisible();
    await ideas.getByLabel("Idea visit start time", { exact: true }).fill("15:30");
    await corrected.getByRole("button", { name: "Add to Day 1", exact: true }).click();
    await expect(corrected).toHaveCount(0);
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(
      page.getByRole("application", {
        name: "Geographic map of this day’s real places",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("region", { name: "Geographic day plan", exact: true })
      .getByRole("button", { name: /Corrected riverside pin/ })
      .click();
    const detail = page.getByRole("complementary", {
      name: "Corrected riverside pin visit details",
      exact: true,
    });
    await expect(detail.getByText("Added by you", { exact: true })).toBeVisible();
    await expect(
      detail.getByRole("link", { name: "Open place on Google Maps", exact: true }),
    ).toHaveAttribute("href", /query=38.72,-9.14/);
    await expect(
      detail.getByRole("region", { name: "Recommendation feedback", exact: true }),
    ).toHaveCount(0);
    await detail.getByRole("button", { name: "Edit my place", exact: true }).click();
    await edit
      .getByRole("textbox", { name: "Place name", exact: true })
      .fill("Discarded correction");
    await page.keyboard.press("Escape");
    await expect(edit).not.toBeVisible();
    await expect(detail).toBeVisible();
    await expect(detail.getByRole("button", { name: "Edit my place", exact: true })).toBeFocused();
    await detail.getByRole("button", { name: "Edit my place", exact: true }).click();
    await edit
      .getByRole("textbox", { name: "Place name", exact: true })
      .fill("Renamed scheduled pin");
    await edit.getByRole("button", { name: "Save my place", exact: true }).click();
    const renamedDetail = page.getByRole("complementary", {
      name: "Renamed scheduled pin visit details",
      exact: true,
    });
    await expect(renamedDetail.getByLabel("Visit start time", { exact: true })).toHaveValue(
      "15:30",
    );
    await renamedDetail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("button", { name: /Renamed scheduled pin/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width <= 620) await page.getByLabel("More planning views").selectOption("pack");
    else await page.getByRole("button", { name: "Travel pack", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Printable itinerary/ }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error("Printable pin itinerary is missing");
    const printed = await readFile(path, "utf8");
    expect(printed).toContain("Traveler-added pin · location unverified");
    expect(printed).not.toContain("Qloo original rank");
    expect(errors).toEqual([]);
  });
}
