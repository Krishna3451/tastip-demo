import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`day titles and private notes can be edited from the timeline and reviewed after changes at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    const stops = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops,
    );
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    const edit = page.getByRole("button", { name: "Edit day title and note", exact: true });
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "A title. A little intention.", exact: true });
    await expect(dialog.getByLabel("Day title", { exact: true })).toBeFocused();
    await dialog.getByLabel("Day title", { exact: true }).fill("An unsaved day");
    await dialog.getByLabel("Day notes", { exact: true }).fill("An unsaved reminder");
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(edit).toBeFocused();
    await edit.click();
    await expect(dialog.getByLabel("Day title", { exact: true })).toHaveValue("Day 2");
    await expect(dialog.getByLabel("Day notes", { exact: true })).toHaveValue("");
    await dialog.getByLabel("Day title", { exact: true }).fill("A slow afternoon");
    await dialog
      .getByLabel("Day notes", { exact: true })
      .fill("A quiet evening <for us>\nLeave time for a call.");
    await expect(dialog).toContainText("Day titles appear on shared links");
    await dialog.getByRole("button", { name: "Save day notes", exact: true }).click();
    await expect(dialog).not.toBeVisible();
    await expect(edit).toBeFocused();
    await expect(
      page.getByRole("heading", { name: "A slow afternoon in Lisbon", exact: true }),
    ).toBeVisible();
    await expect(page.locator(".day-timeline-note")).toContainText("A quiet evening <for us>");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 2 in Lisbon", exact: true })).toBeVisible();
    await expect(page.locator(".day-timeline-note")).toHaveCount(0);
    if (width <= 620) await page.getByLabel("More planning views").selectOption("ideas");
    else await page.getByRole("button", { name: "Ideas", exact: true }).click();
    const form = page.getByRole("form", { name: "Day title and private note", exact: true });
    const title = form.getByLabel("Day title", { exact: true });
    const note = form.getByLabel("Day notes", { exact: true });
    const save = form.getByRole("button", { name: "Save day notes", exact: true });
    await title.fill("An accepted day");
    await note.fill("Accepted private reminder");
    await save.click();
    await title.fill("Keep this unfinished title");
    await note.fill("Keep this unfinished note");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(title).toHaveValue("Keep this unfinished title");
    await expect(note).toHaveValue("Keep this unfinished note");
    await expect(save).toBeDisabled();
    await expect(form.getByRole("status")).toContainText("This day’s title or note also changed");
    await form.getByRole("button", { name: "Reload latest day", exact: true }).click();
    await expect(title).toHaveValue("Day 2");
    await expect(note).toHaveValue("");
    await expect(title).toBeFocused();
    await title.fill("A slow afternoon");
    await note.fill("A quiet evening <for us>\nLeave time for a call.");
    const route = page.getByRole("region", { name: "Dates and city route", exact: true });
    await route.getByRole("button", { name: "Edit dates & cities", exact: true }).click();
    await route.getByLabel("Trip start date", { exact: true }).fill("2028-04-03");
    await route.getByRole("button", { name: "Save route", exact: true }).click();
    await expect(title).toHaveValue("A slow afternoon");
    await expect(save).toBeDisabled();
    await form
      .getByRole("button", { name: "Keep day draft with latest plan", exact: true })
      .click();
    await expect(title).toBeFocused();
    await save.click();
    await expect(form.getByRole("status")).toHaveText("Day updated.");
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops),
    ).toEqual(stops);
    await page.reload();
    await page.getByRole("button", { name: "A slow afternoon", exact: true }).click();
    await expect(page.locator(".day-timeline-note")).toContainText("A quiet evening <for us>");
    await expect(page.locator(".day-timeline-note")).toContainText("Leave time for a call.");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

for (const width of [375, 1440]) {
  test(`deferred initial day-title focus preserves a chosen notes field at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/studio");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await page.getByRole("button", { name: "Day 2", exact: true }).click();
    const edit = page.getByRole("button", { name: "Edit day title and note", exact: true });
    const dialog = page.getByRole("dialog", { name: "A title. A little intention.", exact: true });
    const title = dialog.getByLabel("Day title", { exact: true });
    const note = dialog.getByLabel("Day notes", { exact: true });
    // Keyboard opening still supplies the ordinary initial title focus.
    await edit.press("Enter");
    await expect(title).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await expect(page.locator(".day-editor-dialog .day-notes-form")).toHaveCount(0);
    const before = await page.evaluate(
      () => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").stops,
    );
    // Model a delayed browser frame while the user chooses a field. No timing sleeps.
    await page.evaluate(() => {
      const request = window.requestAnimationFrame.bind(window);
      const cancel = window.cancelAnimationFrame.bind(window);
      const pending = new Map<number, FrameRequestCallback>();
      let nextId = 0;
      window.requestAnimationFrame = (callback) => {
        const id = --nextId;
        pending.set(id, callback);
        return id;
      };
      window.cancelAnimationFrame = (id) => {
        if (!pending.delete(id)) cancel(id);
      };
      Object.assign(window, {
        releaseSyntheticDayFrames: () => {
          window.requestAnimationFrame = request;
          window.cancelAnimationFrame = cancel;
          const callbacks = [...pending.values()];
          pending.clear();
          for (const callback of callbacks) callback(performance.now());
        },
      });
    });
    await edit.press("Enter");
    await expect(dialog).toBeVisible();
    await title.fill("A calm, exact title");
    await note.focus();
    await page.evaluate(() => {
      const frames = window as unknown as { releaseSyntheticDayFrames: () => void };
      frames.releaseSyntheticDayFrames();
    });
    await expect(note).toBeFocused();
    await page.keyboard.insertText("Exact private note.\nLeave room for a call.");
    await expect(title).toHaveValue("A calm, exact title");
    await expect(note).toHaveValue("Exact private note.\nLeave room for a call.");
    await dialog.getByRole("button", { name: "Save day notes", exact: true }).click();
    await expect(dialog).toBeHidden();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    expect(saved.days.find((day: { id: string }) => day.id === "day-2")).toMatchObject({
      label: "A calm, exact title",
      note: "Exact private note.\nLeave room for a call.",
    });
    expect(saved.stops).toEqual(before);
  });
}
