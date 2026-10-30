import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`private visit notes preserve drafts, undo, venue identity and exports at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByLabel("Number of days", { exact: true }).fill("1");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page.getByRole("button", { name: /Demo · Slow Morning Café/ }).click();
    const panel = page.getByRole("complementary", {
      name: "Demo · Slow Morning Café visit details",
      exact: true,
    });
    const notes = panel.getByRole("region", { name: "Your private visit note", exact: true });
    await notes.getByRole("button", { name: "Add a private note", exact: true }).click();
    await expect(
      notes.getByRole("textbox", { name: "Your visit note", exact: true }),
    ).toBeFocused();
    const text = "Ask about the quiet room <private>.\nBring the tickets.";
    await notes.getByRole("textbox", { name: "Your visit note", exact: true }).fill(text);
    await notes.getByRole("button", { name: "Save visit note", exact: true }).click();
    await expect(notes.getByText(text, { exact: true })).toBeVisible();
    await expect(notes.getByRole("button", { name: "Edit visit note", exact: true })).toBeFocused();
    await notes.getByRole("button", { name: "Edit visit note", exact: true }).click();
    await notes
      .getByRole("textbox", { name: "Your visit note", exact: true })
      .fill("Keep this unsaved text");
    await panel.getByLabel("Visit start time", { exact: true }).fill("09:45");
    await panel.getByRole("button", { name: "Update visit", exact: true }).click();
    await expect(
      notes.getByRole("button", { name: "Save visit note", exact: true }),
    ).toBeDisabled();
    await expect(notes.getByRole("textbox", { name: "Your visit note", exact: true })).toHaveValue(
      "Keep this unsaved text",
    );
    await notes.getByRole("button", { name: "Cancel note edit", exact: true }).click();
    await panel.getByLabel("Visit start time", { exact: true }).fill("09:30");
    await panel.getByRole("button", { name: "Update visit", exact: true }).click();
    await notes.getByRole("button", { name: "Clear visit note", exact: true }).click();
    await expect(notes.getByText(text, { exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(notes.getByText(text, { exact: true })).toBeVisible();
    await panel
      .getByLabel("Replacement place", { exact: true })
      .selectOption({ label: "Demo · Hilltop Garden" });
    await expect(
      panel.getByText("Replacing this place clears its private visit note. Undo brings it back.", {
        exact: true,
      }),
    ).toBeVisible();
    await panel.getByRole("button", { name: "Replace place", exact: true }).click();
    const replacement = page.getByRole("complementary", {
      name: "Demo · Hilltop Garden visit details",
      exact: true,
    });
    await expect(
      replacement.getByRole("button", { name: "Add a private note", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(notes.getByText(text, { exact: true })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "List", exact: true }).click();
    const row = page
      .getByRole("region", { name: "Day itinerary", exact: true })
      .getByRole("button", { name: /Demo · Slow Morning Café/ });
    await expect(row).toContainText("Your note");
    await expect(row).toContainText("Bring the tickets.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Journey", exact: true }).click();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    const timelineVisit = page.getByRole("button", {
      name: "Open Demo · Slow Morning Café, 09:30",
      exact: true,
    });
    await expect(timelineVisit).toContainText("Your note");
    await expect(timelineVisit).toContainText("Bring the tickets.");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("pack");
    else await page.getByRole("button", { name: "Travel pack", exact: true }).click();
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Printable itinerary/ }).click();
    const path = await (await downloadPromise).path();
    if (!path) throw new Error("Printable itinerary is missing");
    expect(await readFile(path, "utf8")).toContain("Ask about the quiet room &lt;private&gt;");
    expect(errors).toEqual([]);
  });
}
