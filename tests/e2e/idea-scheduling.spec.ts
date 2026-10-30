import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";

for (const width of [375, 1440]) {
  test(`scheduling an idea retains choices, rejects overlap and opens the accepted visit at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
    const idea = fixture.places[3]!;
    idea.name = "Qloo scheduling fixture";
    idea.source = "qloo";
    idea.taste = { queryId: "idea-scheduling-fixture-query", rank: 7, score: 0.62 };
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, fixture);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    const openIdeas = async () => {
      if (width <= 620) await page.getByLabel("More planning views").selectOption("ideas");
      else await page.getByRole("button", { name: "Ideas", exact: true }).click();
    };
    await page.goto("/studio");
    await openIdeas();
    const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
    const time = ideas.getByLabel("Idea visit start time", { exact: true });
    const duration = ideas.getByLabel("Idea visit duration", { exact: true });
    const card = ideas
      .getByRole("article")
      .filter({ has: page.getByRole("heading", { name: idea.name, exact: true }) });
    const add = card.getByRole("button", { name: "Add to Day 1", exact: true });
    await time.fill("15:30");
    await duration.fill("0");
    await expect(add).toBeDisabled();
    await expect(duration).toHaveAttribute("aria-invalid", "true");
    await duration.fill("45");
    const spaces = ideas.getByRole("group", {
      name: "Draft spaces for this idea duration",
      exact: true,
    });
    await spaces.getByRole("button", { name: "15:30", exact: true }).click();
    await expect(spaces.getByRole("button", { name: "15:30", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await ideas
      .getByLabel("Day notes", { exact: true })
      .fill("Keep this private note while scheduling.");
    await ideas.getByRole("button", { name: "Save day notes", exact: true }).click();
    await expect(ideas).toContainText("Day updated.");
    await expect(time).toHaveValue("15:30");
    await expect(duration).toHaveValue("45");
    const before = await read();
    await time.fill("09:30");
    await add.click();
    await expect(ideas.getByRole("alert")).toContainText("Your time and duration are still here");
    await expect(time).toHaveValue("09:30");
    await expect(duration).toHaveValue("45");
    expect(await read()).toEqual(before);
    await time.fill("15:30");
    await add.click();
    const result = ideas.getByRole("region", { name: "Last scheduled visit", exact: true });
    await expect(result.getByRole("status")).toHaveText(
      `${idea.name} is on Day 1 at 15:30 for 45 minutes.`,
    );
    const open = result.getByRole("button", { name: "Open added visit", exact: true });
    await expect(open).toBeFocused();
    await expect(time).toHaveValue("18:30");
    await expect(duration).toHaveValue("45");
    const saved = await read();
    const added = saved.stops.find((stop: { placeId: string }) => stop.placeId === idea.id);
    expect(added).toMatchObject({
      placeId: idea.id,
      dayId: "day-1",
      startTime: "15:30",
      durationMinutes: 45,
      pinned: false,
      timeLocked: false,
      selection: idea.taste,
    });
    expect(saved.stops.filter((stop: { id: string }) => stop.id !== added.id)).toEqual(
      before.stops,
    );
    expect(saved.days).toEqual(before.days);
    expect(saved.places).toEqual(before.places);
    await open.click();
    const detail = page.getByRole("complementary", {
      name: `${idea.name} visit details`,
      exact: true,
    });
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("15:30–16:15");
    await expect(detail).toContainText("Qloo");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `Open ${idea.name}, 15:30`, exact: true }),
    ).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    expect((await read()).stops.find((stop: { id: string }) => stop.id === added.id)).toEqual(
      added,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await openIdeas();
    await expect(card).toBeVisible();
    await expect(result).toHaveCount(0);
    expect((await read()).stops).toEqual(before.stops);
    expect((await read()).days).toEqual(before.days);
    expect(errors).toEqual([]);
  });
}
