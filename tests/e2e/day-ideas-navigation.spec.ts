import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";

function fixture() {
  const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const idea = initial.places[3]!;
  idea.name = "Qloo day context fixture";
  idea.source = "qloo";
  idea.taste = { queryId: "day-ideas-context-query", rank: 7 };
  const routed = applyTripCommand(initial, {
    id: "day-ideas-route",
    baseVersion: initial.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-05-10",
          stays: [
            { id: "lisbon-stay", destinationId: "lisbon", days: 2 },
            { id: "porto-stay", destinationId: "porto", days: 1 },
          ],
          transfers: [
            {
              id: "lisbon-porto",
              fromStayId: "lisbon-stay",
              toStayId: "porto-stay",
              mode: "train",
            },
          ],
        },
      },
    ],
  });
  if (!routed.ok) throw new Error(routed.error.message);
  return { trip: routed.trip, idea };
}

for (const width of [375, 1440]) {
  test(`timelines and ideas retain the selected city-day through browsing and scheduling at ${width}px`, async ({
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
    const before = await read();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    const add = page.getByRole("region", { name: "Add a place to this day", exact: true });
    await expect(add).toContainText("5 ideas in Lisbon");
    await add.getByRole("button", { name: "Add to this day", exact: true }).click();
    const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
    await expect(
      ideas.getByRole("heading", { name: "Keep an idea. Make it a moment.", exact: true }),
    ).toBeFocused();
    const context = ideas.getByRole("region", { name: "Day for these ideas", exact: true });
    await expect(context).toContainText("Day 1 · Lisbon");
    await expect(context).toContainText("2028-05-10 · Europe/Lisbon");
    await context.getByRole("button", { name: "Open day timeline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeFocused();
    expect(await read()).toEqual(before);
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 2 in Lisbon", exact: true })).toBeFocused();
    await expect(page.getByText("A day waiting to be yours.", { exact: true })).toBeVisible();
    await expect(add).toContainText("5 ideas in Lisbon");
    await add.getByRole("button", { name: "Add to this day", exact: true }).click();
    await expect(context).toContainText("Day 2 · Lisbon");
    await expect(context).toContainText("2028-05-11 · Europe/Lisbon");
    await ideas.getByLabel("Idea visit start time", { exact: true }).fill("11:00");
    await ideas.getByLabel("Idea visit duration", { exact: true }).fill("30");
    await ideas
      .getByRole("searchbox", { name: "Search place ideas", exact: true })
      .fill(prepared.idea.name);
    await ideas.getByRole("button", { name: "Add to Day 2", exact: true }).click();
    const result = ideas.getByRole("region", { name: "Last scheduled visit", exact: true });
    await expect(result).toContainText("is on Day 2 at 11:00 for 30 minutes.");
    await result.getByRole("button", { name: "Open added visit", exact: true }).click();
    const detail = page.getByRole("complementary", {
      name: `${prepared.idea.name} visit details`,
      exact: true,
    });
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("Day 2");
    await expect(detail).toContainText("11:00–11:30");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Open ${prepared.idea.name}, 11:00`, exact: true }),
    ).toBeFocused();
    await expect(add).toContainText("4 ideas in Lisbon");
    const saved = await read();
    const visit = saved.stops.find(
      (stop: { placeId: string }) => stop.placeId === prepared.idea.id,
    );
    expect(visit).toMatchObject({
      dayId: "day-2",
      startTime: "11:00",
      durationMinutes: 30,
      selection: prepared.idea.taste,
    });
    expect(saved.stops.filter((stop: { id: string }) => stop.id !== visit.id)).toEqual(
      before.stops,
    );
    await page.getByRole("button", { name: "Next day", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 3 in Porto", exact: true })).toBeFocused();
    await expect(add).toContainText("Keep a place you know as an idea");
    await add.getByRole("button", { name: "Add to this day", exact: true }).click();
    await expect(context).toContainText("Day 3 · Porto");
    await expect(context).toContainText("2028-05-12 · Europe/Lisbon");
    await expect(ideas.getByRole("status")).toHaveText("Showing 0 of 0 ideas for Porto.");
    await page
      .getByRole("group", { name: "Trip day", exact: true })
      .getByRole("button", { name: "Day 1", exact: true })
      .click();
    await expect(context).toContainText("Day 1 · Lisbon");
    await expect(context).toContainText("2028-05-10 · Europe/Lisbon");
    await context.getByRole("button", { name: "Open day timeline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeFocused();
    expect(await read()).toEqual(saved);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
