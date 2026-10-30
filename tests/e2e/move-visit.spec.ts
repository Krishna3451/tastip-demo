import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`moving a selected visit follows its day and restores focus without changing its identity at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    const before = await read();
    const original = before.stops[0];
    const others = before.stops.filter((stop: { id: string }) => stop.id !== original.id);
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page
      .getByRole("button", { name: "Open Demo · Slow Morning Café, 09:30", exact: true })
      .click();
    const detail = page.getByRole("complementary", {
      name: "Demo · Slow Morning Café visit details",
      exact: true,
    });
    await detail.getByRole("button", { name: "Add a private note", exact: true }).click();
    await detail
      .getByLabel("Your visit note", { exact: true })
      .fill("Keep the reminder with this visit.");
    await detail.getByRole("button", { name: "Save visit note", exact: true }).click();
    await detail.getByRole("button", { name: "Keep this place", exact: true }).click();
    const move = async () => {
      await detail.getByRole("combobox", { name: "Day", exact: true }).selectOption("day-2");
      await detail.getByLabel("Visit start time", { exact: true }).fill("11:00");
      await detail.getByRole("button", { name: "Update visit", exact: true }).click();
    };
    await move();
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("Day 2");
    await expect(detail.getByRole("button", { name: "Place pinned", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    const moved = (await read()).stops.find((stop: { id: string }) => stop.id === original.id);
    expect(moved).toEqual({
      ...original,
      dayId: "day-2",
      startTime: "11:00",
      pinned: true,
      note: "Keep the reminder with this visit.",
    });
    expect((await read()).stops.filter((stop: { id: string }) => stop.id !== original.id)).toEqual(
      others,
    );
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 2 in Lisbon", exact: true })).toBeVisible();
    const movedCard = page.getByRole("button", {
      name: "Open Demo · Slow Morning Café, 11:00",
      exact: true,
    });
    await expect(movedCard).toBeFocused();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(movedCard).toHaveCount(0);
    await page.getByRole("button", { name: "Previous day", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Open Demo · Slow Morning Café, 09:30", exact: true })
      .click();
    await expect(detail.getByLabel("Visit start time", { exact: true })).toHaveValue("09:30");
    await expect(
      detail.getByText("Keep the reminder with this visit.", { exact: true }),
    ).toBeVisible();
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Demo · Slow Morning Café, 09:30", exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "List", exact: true }).click();
    const list = page.getByRole("region", { name: "Day itinerary", exact: true });
    await list.getByRole("button", { name: /Demo · Slow Morning Café/ }).click();
    await move();
    await expect(detail.getByLabel("Visit start time", { exact: true })).toHaveValue("11:00");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      page
        .getByRole("group", { name: "Trip day", exact: true })
        .getByRole("button", { name: "Day 1", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(detail.getByLabel("Visit start time", { exact: true })).toHaveValue("09:30");
    await move();
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page
        .getByRole("group", { name: "Trip day", exact: true })
        .getByRole("button", { name: "Day 2", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    const listCard = list.getByRole("button", { name: /Demo · Slow Morning Café/ });
    await expect(listCard).toBeFocused();
    await expect(listCard).toContainText("11:00");
    await page.reload();
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(movedCard).toBeVisible();
    expect((await read()).stops.find((stop: { id: string }) => stop.id === original.id)).toEqual(
      moved,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
