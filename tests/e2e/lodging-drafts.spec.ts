import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`lodging drafts keep names and private details through newer edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    const route = page.getByRole("region", { name: "Dates and city route", exact: true });
    const setDate = async (date: string) => {
      await route.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
      await route.getByLabel("Trip start date", { exact: true }).fill(date);
      await route.getByRole("button", { name: "Save route", exact: true }).click();
    };
    await setDate("2028-05-10");
    await setDate("2028-05-11");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("stays");
    else await page.getByRole("button", { name: "Stays", exact: true }).click();
    const stays = page.getByRole("region", { name: "Planned stays", exact: true });
    const details = stays.locator(".traveler-lodging");
    await details.locator("summary").click();
    const form = stays.getByRole("form", { name: "Your lodging idea", exact: true });
    const name = form.getByLabel("Lodging name", { exact: true });
    const address = form.getByRole("textbox", { name: /^Lodging address/ });
    const website = form.getByRole("textbox", { name: /^Property or booking link/ });
    const save = form.getByRole("button", { name: "Save my lodging idea", exact: true });
    await name.fill("Keep this lodging name");
    await address.fill("Private lodging draft address");
    await website.fill("https://example.test/private-lodging-draft");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(name).toHaveValue("Keep this lodging name");
    await expect(address).toHaveValue("Private lodging draft address");
    await expect(website).toHaveValue("https://example.test/private-lodging-draft");
    await expect(save).toBeDisabled();
    await form
      .getByRole("button", { name: "Keep lodging draft with latest plan", exact: true })
      .click();
    await expect(name).toBeFocused();
    await save.click();
    await expect(details).toHaveJSProperty("open", false);
    await expect(details.locator("summary")).toBeFocused();
    const originalId = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").lodgings[0].candidate.id,
    );
    await details.locator("summary").click();
    await name.fill("An unfinished replacement");
    await stays.getByRole("button", { name: "Remove lodging idea", exact: true }).click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(name).toHaveValue("An unfinished replacement");
    await expect(address).toHaveValue("Private lodging draft address");
    await expect(form.getByRole("status")).toContainText("The saved lodging idea also changed");
    await expect(save).toBeDisabled();
    await form.getByRole("button", { name: "Reload latest lodging", exact: true }).click();
    await expect(name).toHaveValue("");
    await expect(address).toHaveValue("");
    await expect(website).toHaveValue("");
    await expect(name).toBeFocused();
    await name.fill("Current lodging idea");
    await address.fill("Current private address");
    await website.fill("https://example.test/current-lodging");
    await save.click();
    const currentId = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").lodgings[0].candidate.id,
    );
    expect(currentId).not.toBe(originalId);
    await details.locator("summary").click();
    await name.fill("Updated lodging idea");
    await save.click();
    await details.locator("summary").click();
    await expect(name).toHaveValue("Updated lodging idea");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(details).toHaveJSProperty("open", true);
    await expect(name).toHaveValue("Current lodging idea");
    await expect(address).toHaveValue("Current private address");
    await expect(form.getByRole("status")).toHaveCount(0);
    await expect(save).toBeDisabled();
    await name.fill("An optional detour");
    await form.getByRole("button", { name: "Reset lodging draft", exact: true }).click();
    await expect(name).toHaveValue("Current lodging idea");
    await expect(name).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
