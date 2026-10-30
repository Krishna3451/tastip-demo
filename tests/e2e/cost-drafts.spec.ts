import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`cost drafts survive undo and removals without overwriting newer entries at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    if (width <= 620) await page.getByLabel("More planning views").selectOption("costs");
    else await page.getByRole("button", { name: "Costs", exact: true }).click();
    const costs = page.getByRole("region", { name: "Plan what you’ll spend." });
    const name = costs.getByLabel("Cost name", { exact: true });
    const amount = costs.getByLabel("Unit amount", { exact: true });
    const save = costs.getByRole("button", { name: "Save cost", exact: true });
    const add = costs.getByRole("button", { name: "Add cost", exact: true });
    const undo = page.getByRole("button", { name: "Undo", exact: true });
    const readCosts = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").costs);
    await name.fill("Museum tickets");
    await amount.fill("10.00");
    await add.click();
    await expect(name).toBeFocused();
    const originalId = (await readCosts())[0].id;
    await costs.getByRole("button", { name: "Edit cost: Museum tickets", exact: true }).click();
    await amount.fill("12.00");
    await save.click();
    await costs.getByRole("button", { name: "Edit cost: Museum tickets", exact: true }).click();
    await name.fill("Evening tickets");
    await amount.fill("15.00");
    await undo.click();
    await expect(name).toHaveValue("Evening tickets");
    await expect(amount).toHaveValue("15.00");
    await expect(costs.getByRole("status")).toContainText("The recorded cost also changed");
    await expect(save).toBeDisabled();
    expect((await readCosts())[0]).toMatchObject({ id: originalId, unitAmountMinor: 1000 });
    await costs.getByRole("button", { name: "Continue as new cost", exact: true }).click();
    await expect(name).toBeFocused();
    await add.click();
    const evening = (await readCosts()).find(
      (cost: { label: string }) => cost.label === "Evening tickets",
    );
    expect(evening.id).not.toBe(originalId);
    expect(
      (await readCosts()).find((cost: { id: string }) => cost.id === originalId).unitAmountMinor,
    ).toBe(1000);
    await name.fill("Taxi");
    await amount.fill("5.00");
    await add.click();
    await costs.getByRole("button", { name: "Edit cost: Evening tickets", exact: true }).click();
    await amount.fill("20.00");
    await costs.getByRole("button", { name: "Remove cost: Taxi", exact: true }).click();
    await expect(amount).toHaveValue("20.00");
    await expect(save).toBeDisabled();
    await costs.getByRole("button", { name: "Keep draft with latest plan", exact: true }).click();
    await expect(name).toBeFocused();
    await save.click();
    expect(await readCosts()).toHaveLength(2);
    expect(
      (await readCosts()).find((cost: { id: string }) => cost.id === evening.id).unitAmountMinor,
    ).toBe(2000);
    await name.fill("Dinner");
    await amount.fill("35.00");
    await undo.click();
    await expect(name).toHaveValue("Dinner");
    await expect(amount).toHaveValue("35.00");
    await expect(add).toBeDisabled();
    await costs.getByRole("button", { name: "Keep draft with latest plan", exact: true }).click();
    await add.click();
    await costs.getByRole("button", { name: "Edit cost: Dinner", exact: true }).click();
    await amount.fill("36.00");
    await undo.click();
    await expect(costs.getByRole("status")).toContainText("The recorded cost was removed");
    await expect(amount).toHaveValue("36.00");
    await costs.getByRole("button", { name: "Continue as new cost", exact: true }).click();
    await costs.getByRole("button", { name: "Reset entry", exact: true }).click();
    await expect(name).toHaveValue("");
    await expect(name).toBeFocused();
    await costs.getByRole("button", { name: "Edit cost: Evening tickets", exact: true }).click();
    await expect(amount).toHaveValue("15.00");
    await amount.fill("16.00");
    await save.click();
    await costs.getByRole("button", { name: "Edit cost: Evening tickets", exact: true }).click();
    await expect(amount).toHaveValue("16.00");
    await undo.click();
    await expect(amount).toHaveValue("15.00");
    await expect(costs.getByRole("status")).toHaveCount(0);
    await expect(costs.getByRole("listitem", { name: "Taxi", exact: true })).toHaveCount(0);
    await expect(save).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
