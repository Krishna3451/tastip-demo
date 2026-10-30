import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";

function fixture() {
  const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  initial.stops[1]!.startTime = "11:00";
  const idea = initial.places[3]!;
  idea.name = "Qloo gap fixture";
  idea.source = "qloo";
  idea.taste = { queryId: "timeline-gap-query", rank: 7 };
  const routed = applyTripCommand(initial, {
    id: "timeline-gap-route",
    baseVersion: initial.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-05-10",
          stays: [{ id: "lisbon-stay", destinationId: "lisbon", days: 2 }],
          transfers: [],
        },
      },
    ],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  return { trip: routed.trip, idea };
}

for (const width of [375, 1440]) {
  test(`a timeline gap prepares an explicit idea draft without leaking it across days at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prepared = fixture();
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, prepared.trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto("/studio");
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    const before = await read();
    const gap = page.getByRole("button", {
      name: "Plan in the gap at 10:30 on Day 1",
      exact: true,
    });
    await expect(gap).toBeVisible();
    await gap.click();
    const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
    const time = ideas.getByLabel("Idea visit start time", { exact: true });
    const duration = ideas.getByLabel("Idea visit duration", { exact: true });
    await expect(time).toHaveValue("10:30");
    await expect(duration).toHaveValue("30");
    expect(await read()).toEqual(before);
    const back = ideas.getByRole("button", { name: "Open day timeline", exact: true });
    await back.click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeFocused();
    await page.getByRole("button", { name: "Add to this day", exact: true }).click();
    await expect(time).toHaveValue("12:30");
    await expect(duration).toHaveValue("60");
    await back.click();
    await gap.click();
    await expect(duration).toHaveValue("30");
    const days = page.getByRole("group", { name: "Trip day", exact: true });
    await days.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(time).toHaveValue("09:30");
    await expect(duration).toHaveValue("60");
    await days.getByRole("button", { name: "Day 1", exact: true }).click();
    await expect(time).toHaveValue("12:30");
    await expect(duration).toHaveValue("60");
    await back.click();
    await gap.click();
    await ideas
      .getByRole("searchbox", { name: "Search place ideas", exact: true })
      .fill(prepared.idea.name);
    await duration.fill("31");
    const add = ideas.getByRole("button", { name: "Add to Day 1", exact: true });
    await add.click();
    await expect(ideas.getByRole("alert")).toContainText("Your time and duration are still here");
    await expect(time).toHaveValue("10:30");
    await expect(duration).toHaveValue("31");
    expect(await read()).toEqual(before);
    await duration.fill("30");
    await add.click();
    const result = ideas.getByRole("region", { name: "Last scheduled visit", exact: true });
    await expect(result).toContainText("Day 1 at 10:30 for 30 minutes.");
    const saved = await read();
    const visit = saved.stops.find(
      (stop: { placeId: string }) => stop.placeId === prepared.idea.id,
    );
    expect(visit).toMatchObject({
      dayId: "day-1",
      startTime: "10:30",
      durationMinutes: 30,
      selection: prepared.idea.taste,
    });
    expect(saved.stops.filter((stop: { id: string }) => stop.id !== visit.id)).toEqual(
      before.stops,
    );
    expect(saved.days).toEqual(before.days);
    expect(saved.places).toEqual(before.places);
    await result.getByRole("button", { name: "Open added visit", exact: true }).click();
    const detail = page.getByRole("complementary", {
      name: `${prepared.idea.name} visit details`,
      exact: true,
    });
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("10:30–11:00");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Open ${prepared.idea.name}, 10:30`, exact: true }),
    ).toBeFocused();
    await expect(gap).toHaveCount(0);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(gap).toBeVisible();
    expect((await read()).stops).toEqual(before.stops);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
