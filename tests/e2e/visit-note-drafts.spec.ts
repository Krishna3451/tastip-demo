import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";

for (const width of [375, 1440]) {
  test(`private note drafts can be reviewed without overwriting changed notes or venues at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
    const place = fixture.places[0]!;
    place.source = "qloo";
    place.name = "Note draft café fixture";
    place.taste = { queryId: "note-draft-fixture-query", rank: 1 };
    fixture.stops[0]!.selection = structuredClone(place.taste);
    fixture.stops[0]!.note = "Original private reminder.";
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, fixture);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto("/studio");
    const original = await read();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page.getByRole("button", { name: `Open ${place.name}, 09:30`, exact: true }).click();
    const panel = page.getByRole("complementary", {
      name: `${place.name} visit details`,
      exact: true,
    });
    const notes = page.getByRole("region", { name: "Your private visit note", exact: true });
    const text = notes.getByRole("textbox", { name: "Your visit note", exact: true });
    const save = notes.getByRole("button", { name: "Save visit note", exact: true });
    const edit = notes.getByRole("button", { name: "Edit visit note", exact: true });
    const keep = notes.getByRole("button", {
      name: "Keep note draft with latest plan",
      exact: true,
    });
    const reload = notes.getByRole("button", { name: "Reload latest visit note", exact: true });
    await edit.click();
    await text.fill("Keep my unfinished private note.");
    await panel.getByRole("button", { name: "Keep this place", exact: true }).click();
    await expect(text).toHaveValue("Keep my unfinished private note.");
    await expect(save).toBeDisabled();
    await expect(keep).toBeVisible();
    const pinned = await read();
    expect(pinned.stops[0].note).toBe(original.stops[0].note);
    await keep.click();
    await expect(text).toBeFocused();
    await expect(save).toBeEnabled();
    expect(await read()).toEqual(pinned);
    await save.click();
    await expect(edit).toBeFocused();
    const firstSaved = await read();
    expect(firstSaved.stops[0]).toEqual({
      ...original.stops[0],
      pinned: true,
      note: "Keep my unfinished private note.",
    });
    await panel.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Open ${place.name}, 09:30`, exact: true }),
    ).toBeFocused();
    await page.getByRole("button", { name: "List", exact: true }).click();
    await page
      .getByRole("region", { name: "Day itinerary", exact: true })
      .getByRole("button", { name: new RegExp(place.name) })
      .click();

    await edit.click();
    await panel.getByRole("button", { name: "More like this", exact: true }).click();
    await expect(text).toHaveValue("Keep my unfinished private note.");
    await expect(notes.getByRole("status")).toHaveCount(0);
    await expect(save).toBeDisabled();
    await text.fill("Saved private note to undo.");
    await save.click();
    await edit.click();
    await text.fill("Keep this later unfinished note.");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(text).toHaveValue("Keep this later unfinished note.");
    await expect(notes.getByRole("status")).toContainText("note or place also changed");
    await expect(keep).toHaveCount(0);
    await expect(save).toBeDisabled();
    const beforeReload = await read();
    expect(beforeReload.stops[0].note).toBe("Keep my unfinished private note.");
    await reload.click();
    await expect(text).toBeFocused();
    await expect(text).toHaveValue("Keep my unfinished private note.");
    await expect(save).toBeDisabled();
    expect(await read()).toEqual(beforeReload);

    await text.fill("A reminder intended only for the old venue.");
    await panel.getByRole("button", { name: "Place pinned", exact: true }).click();
    await expect(text).toHaveValue("A reminder intended only for the old venue.");
    await panel.getByLabel("Replacement place", { exact: true }).selectOption({
      label: "Demo · Hilltop Garden",
    });
    await panel.getByRole("button", { name: "Replace place", exact: true }).click();
    await expect(text).toHaveValue("A reminder intended only for the old venue.");
    await expect(notes.getByRole("status")).toContainText("note or place also changed");
    await expect(keep).toHaveCount(0);
    await expect(save).toBeDisabled();
    expect((await read()).stops[0].note).toBeUndefined();
    await reload.click();
    await expect(text).toBeFocused();
    await expect(text).toHaveValue("");
    await expect(save).toBeDisabled();
    await text.fill("New venue’s private reminder.");
    await save.click();
    const changed = await read();
    expect(changed.stops[0].id).toBe(original.stops[0].id);
    expect(changed.stops[0].placeId).not.toBe(original.stops[0].placeId);
    expect(changed.stops[0].note).toBe("New venue’s private reminder.");
    expect(changed.stops[0].selection).toBeUndefined();
    expect(changed.stops.slice(1)).toEqual(original.stops.slice(1));
    expect(changed.places).toEqual(original.places);
    await page.reload();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Open Demo · Hilltop Garden, 09:30", exact: true }),
    ).toContainText("New venue’s private reminder.");
    expect((await read()).stops).toEqual(changed.stops);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
