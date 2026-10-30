import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

async function openCosts(page: Page, width: number) {
  if (width <= 620) await page.getByLabel("More planning views").selectOption("costs");
  else await page.getByRole("button", { name: "Costs", exact: true }).click();
}

for (const width of [375, 1440]) {
  test(`planned costs keep exact currency subtotals, edits and backups at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByLabel("Number of travelers", { exact: true }).fill("2");
    await page.locator("summary").filter({ hasText: "Origin & activity budget" }).click();
    await page.getByLabel("Activity budget (EUR)", { exact: true }).fill("40");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await openCosts(page, width);
    const costs = page.getByRole("region", { name: "Plan what you’ll spend." });
    await costs.getByLabel("Cost name", { exact: true }).fill("Museum tickets");
    await costs.getByLabel("Unit amount", { exact: true }).fill("12.50");
    await costs.getByLabel("Quantity", { exact: true }).fill("2");
    await costs
      .getByRole("combobox", { name: "Applies to", exact: true })
      .selectOption("each-traveler");
    await costs.getByRole("button", { name: "Add cost", exact: true }).click();
    const museum = costs.getByRole("listitem", { name: "Museum tickets", exact: true });
    await expect(museum).toContainText("50.00");
    await costs.getByLabel("Cost name", { exact: true }).fill("Rail plan");
    await costs.getByRole("combobox", { name: "Currency", exact: true }).selectOption("JPY");
    await costs.getByRole("combobox", { name: "Category", exact: true }).selectOption("transport");
    await costs.getByLabel("Unit amount", { exact: true }).fill("1500.5");
    await costs.getByRole("button", { name: "Add cost", exact: true }).click();
    await expect(costs.getByRole("alert")).toContainText("whole yen");
    await costs.getByLabel("Unit amount", { exact: true }).fill("1500");
    await costs.getByRole("button", { name: "Add cost", exact: true }).click();
    const subtotals = costs.getByLabel("Recorded cost subtotals");
    await expect(subtotals).toContainText("EUR");
    await expect(subtotals).toContainText("50.00");
    await expect(subtotals).toContainText("JPY");
    await expect(subtotals).toContainText("1,500");
    await expect(costs.getByRole("region", { name: "Activity budget comparison" })).toContainText(
      "10.00",
    );
    await costs.getByRole("button", { name: "Edit cost: Museum tickets", exact: true }).click();
    await costs.getByLabel("Unit amount", { exact: true }).fill("15.00");
    await costs.getByRole("button", { name: "Save cost", exact: true }).click();
    await expect(museum).toContainText("60.00");
    await costs.getByRole("button", { name: "Remove cost: Museum tickets", exact: true }).click();
    await expect(museum).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(museum).toContainText("60.00");
    await page.reload();
    await openCosts(page, width);
    await expect(museum).toContainText("60.00");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    if (width <= 620) await page.getByLabel("More planning views").selectOption("pack");
    else await page.getByRole("button", { name: "Travel pack", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Trip backup/ }).click();
    const download = await downloadPromise;
    const backup = JSON.parse(await readFile((await download.path())!, "utf8"));
    expect(backup.costs).toHaveLength(2);
    expect(
      backup.costs.find((cost: { label: string }) => cost.label === "Museum tickets")
        .unitAmountMinor,
    ).toBe(1500);
    expect(errors).toEqual([]);
  });
}
