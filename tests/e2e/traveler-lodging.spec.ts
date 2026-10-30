import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

async function openView(page: Page, width: number, view: "stays" | "pack") {
  if (width <= 620) await page.getByLabel("More planning views").selectOption(view);
  else
    await page
      .getByRole("button", { name: view === "stays" ? "Stays" : "Travel pack", exact: true })
      .click();
}

for (const width of [375, 1440]) {
  test(`traveler lodging is editable, undoable and included in private exports at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await page.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await page.getByLabel("Trip start date").fill("2028-02-28");
    await page.getByRole("button", { name: "Save route", exact: true }).click();
    await openView(page, width, "stays");
    const stays = page.getByRole("region", { name: "Planned stays", exact: true });
    await stays.locator("summary").filter({ hasText: "Add lodging you’ve found" }).click();
    const form = stays.getByRole("form", { name: "Your lodging idea", exact: true });
    await form
      .getByRole("textbox", { name: "Lodging name", exact: true })
      .fill("Traveler stay fixture");
    await form.getByRole("textbox", { name: /^Lodging address/ }).fill("Private address fixture");
    await form
      .getByRole("textbox", { name: /^Property or booking link/ })
      .fill("https://user:password@example.test/stay");
    await form.getByRole("button", { name: "Save my lodging idea", exact: true }).click();
    await expect(form.getByRole("alert")).toContainText("without sign-in details");
    await form
      .getByRole("textbox", { name: /^Property or booking link/ })
      .fill("https://example.test/stay");
    await form.getByRole("button", { name: "Save my lodging idea", exact: true }).click();
    await expect(
      stays.getByRole("heading", { name: "Traveler stay fixture", exact: true }),
    ).toBeVisible();
    await expect(
      stays.getByText("Entered by you · details unverified", { exact: true }),
    ).toBeVisible();
    await expect(
      stays.getByRole("link", { name: "Open your lodging link ↗", exact: true }),
    ).toHaveAttribute("href", "https://example.test/stay");
    await stays.locator("summary").filter({ hasText: "Edit lodging you added" }).click();
    await form
      .getByRole("textbox", { name: "Lodging name", exact: true })
      .fill("Updated traveler stay");
    await form.getByRole("button", { name: "Save my lodging idea", exact: true }).click();
    await stays.getByRole("button", { name: "Remove lodging idea", exact: true }).click();
    await expect(
      stays.getByRole("heading", { name: "Updated traveler stay", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      stays.getByRole("heading", { name: "Updated traveler stay", exact: true }),
    ).toBeVisible();
    await page.reload();
    await openView(page, width, "stays");
    await expect(
      stays.getByRole("heading", { name: "Updated traveler stay", exact: true }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await openView(page, width, "pack");
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Printable itinerary/ }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error("Itinerary download is missing");
    const printed = await readFile(path, "utf8");
    expect(printed).toContain("Updated traveler stay");
    expect(printed).toContain("Private address fixture");
    expect(printed).toContain("Entered by you · details unverified");
    expect(errors).toEqual([]);
  });
}
