import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";

for (const width of [375, 1440]) {
  test(`visit schedule drafts explain conflicts and survive newer edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = createDemoTrip(DEFAULT_BRIEF);
    const place = fixture.places[0]!;
    place.source = "qloo";
    place.name = "Schedule draft café fixture";
    place.taste = { queryId: "visit-schedule-fixture-query", rank: 1 };
    fixture.stops[0]!.selection = structuredClone(place.taste);
    fixture.stops[0]!.pinned = true;
    fixture.stops[0]!.note = "Keep the original private reminder.";
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, fixture);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page.getByRole("button", { name: `Open ${place.name}, 09:30`, exact: true }).click();
    const detail = page.getByRole("complementary", {
      name: `${place.name} visit details`,
      exact: true,
    });
    const form = detail.locator(".visit-edit-form");
    const time = form.getByLabel("Visit start time", { exact: true });
    const duration = form.getByLabel("Visit duration", { exact: true });
    const update = form.getByRole("button", { name: "Update visit", exact: true });
    const original = await read();
    await time.fill("12:00");
    await update.click();
    const error = form.getByRole("alert");
    await expect(error).toContainText("These visits overlap");
    await expect(error).toBeFocused();
    await expect(time).toHaveValue("12:00");
    expect(await read()).toEqual(original);

    await time.fill("10:45");
    await duration.fill("45");
    await expect(error).toHaveCount(0);
    const notes = detail.getByRole("region", { name: "Your private visit note", exact: true });
    await notes.getByRole("button", { name: "Edit visit note", exact: true }).click();
    await notes
      .getByRole("textbox", { name: "Your visit note", exact: true })
      .fill("Keep the newer private reminder.");
    await notes.getByRole("button", { name: "Save visit note", exact: true }).click();
    await expect(time).toHaveValue("10:45");
    await expect(duration).toHaveValue("45");
    await expect(update).toBeDisabled();
    await expect(form.getByRole("status")).toContainText("Your visit draft is still here");
    const keep = form.getByRole("button", {
      name: "Keep visit draft with latest plan",
      exact: true,
    });
    await keep.click();
    await expect(time).toBeFocused();
    await expect(time).toHaveValue("10:45");
    await expect(duration).toHaveValue("45");
    await update.click();
    await expect(form.getByRole("status")).toHaveText("Visit updated.");
    const saved = await read();
    expect(saved.stops[0]).toEqual({
      ...original.stops[0],
      startTime: "10:45",
      durationMinutes: 45,
      note: "Keep the newer private reminder.",
    });

    await detail.getByRole("button", { name: "Fix the time", exact: true }).click();
    const locked = await read();
    await time.fill("11:00");
    await update.click();
    await expect(error).toContainText("Unlock this visit's time before moving it");
    await expect(error).toBeFocused();
    expect(await read()).toEqual(locked);
    await detail.getByRole("button", { name: "Time fixed", exact: true }).click();
    await expect(error).toHaveCount(0);
    await expect(time).toHaveValue("11:00");
    await expect(update).toBeDisabled();
    await keep.click();
    await update.click();
    await expect(form.getByRole("status")).toHaveText("Visit updated.");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Open ${place.name}, 11:00`, exact: true }),
    ).toBeFocused();
    await page.reload();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    expect((await read()).stops[0].startTime).toBe("11:00");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect((await read()).stops[0].startTime).toBe("10:45");

    await page.getByRole("button", { name: "List", exact: true }).click();
    await page
      .getByRole("region", { name: "Day itinerary", exact: true })
      .getByRole("button", { name: new RegExp(place.name) })
      .click();
    await time.fill("11:00");
    await update.click();
    await time.fill("11:15");
    const beforeUndo = await read();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(time).toHaveValue("11:15");
    await expect(form.getByRole("status")).toContainText("place or schedule also changed");
    await expect(keep).toHaveCount(0);
    await expect(update).toBeDisabled();
    expect((await read()).stops[0].startTime).toBe("10:45");
    await form.getByRole("button", { name: "Reload latest visit time", exact: true }).click();
    await expect(time).toBeFocused();
    await expect(time).toHaveValue("10:45");
    await expect(duration).toHaveValue("45");
    await expect(update).toBeDisabled();
    const restored = await read();
    expect(restored.stops[0]).toEqual({ ...beforeUndo.stops[0], startTime: "10:45" });
    expect(restored.stops.slice(1)).toEqual(original.stops.slice(1));
    expect(restored.places).toEqual(original.places);
    await time.fill("11:30");
    await form.getByRole("button", { name: "Reset visit draft", exact: true }).click();
    await expect(time).toHaveValue("10:45");
    expect(await read()).toEqual(restored);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
