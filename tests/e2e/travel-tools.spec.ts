import { expect, test } from "@playwright/test";

test("local collection saves and reopens a trip without changing its canonical visits", async ({
  page,
}) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Saved trips", exact: true }).click();
  const library = page.getByRole("region", { name: "Saved trips", exact: true });
  await library.getByRole("button", { name: "Save current trip", exact: true }).click();
  await expect(library.getByRole("status")).toContainText("Saved to this browser");
  await page.getByRole("button", { name: "New trip", exact: true }).click();
  await page.getByRole("button", { name: "Saved trips", exact: true }).click();
  await page.getByRole("button", { name: "Open saved Lisbon trip", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lisbon");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Saved trips", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open saved Lisbon trip", exact: true }),
  ).toBeVisible();
});

test("invalid JSON backup leaves the active draft intact", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Saved trips", exact: true }).click();
  await page.getByLabel("Import Tastip trip backup", { exact: true }).setInputFiles({
    name: "invalid-tastip.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ id: "not-a-trip", version: 99 })),
  });
  await expect(
    page.getByRole("status").filter({ hasText: "not a valid Tastip trip backup" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lisbon");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toBeVisible();
});

test("calendar selects canonical days and visit details; undated calendar export explains what is missing", async ({
  page,
}) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
  await calendar.getByRole("button", { name: /Day 2 Dates open Lisbon/ }).click();
  await expect(calendar.getByRole("button", { name: /Day 2 Dates open Lisbon/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await calendar.getByRole("button", { name: /09:30.*Demo · Hilltop Garden/ }).click();
  await expect(
    page.getByRole("complementary", { name: "Demo · Hilltop Garden visit details" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close visit details", exact: true }).click();
  await calendar.getByRole("button", { name: "Open Day 2 timeline", exact: true }).click();
  const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
  await expect(
    journey.getByRole("heading", { name: "Day 2 in Lisbon", exact: true }),
  ).toBeFocused();
  await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toContainText(
    "Demo · Hilltop Garden",
  );
  await journey.getByRole("button", { name: "All days", exact: true }).click();
  await page.getByRole("button", { name: "Calendar", exact: true }).click();
  await expect(calendar.getByRole("button", { name: /Day 2 Dates open Lisbon/ })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByRole("button", { name: "Travel pack", exact: true }).click();
  await page.getByRole("button", { name: /Calendar file/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Set trip dates" })).toBeVisible();
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /Trip backup/ }).click();
  expect((await downloadPromise).suggestedFilename()).toBe("tastip-lisbon-backup.json");
});
