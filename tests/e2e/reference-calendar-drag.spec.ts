import { expect, type Page, test } from "@playwright/test";
import {
  applyTripCommand,
  createDemoTrip,
  DEFAULT_BRIEF,
  type Trip,
} from "../../packages/domain/src";

function fixture(mode: "same-city" | "locked" | "cross-city" = "same-city") {
  const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: mode === "cross-city" ? 1 : 2 });
  const result = applyTripCommand(initial, {
    id: "calendar-drag-fixture",
    baseVersion: initial.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2027-03-01",
          stays:
            mode === "cross-city"
              ? [
                  { id: "lisbon", destinationId: "lisbon", days: 1 },
                  { id: "porto", destinationId: "porto", days: 1 },
                ]
              : [{ id: "lisbon", destinationId: "lisbon", days: 2 }],
          transfers:
            mode === "cross-city"
              ? [{ id: "transfer", fromStayId: "lisbon", toStayId: "porto", mode: "train" }]
              : [],
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  if (mode !== "locked") return result.trip;
  const locked = applyTripCommand(result.trip, {
    id: "lock-calendar-drag-fixture",
    baseVersion: result.trip.version,
    operations: [{ type: "lock-time", stopId: result.trip.stops[0]!.id, timeLocked: true }],
  });
  if (!locked.ok) throw new Error(locked.error.message);
  return locked.trip;
}

async function open(page: Page, trip: Trip) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript((trip) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
  }, trip);
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: /^Calendar/ }).click();
  await page
    .getByRole("region", { name: "Trip calendar", exact: true })
    .getByLabel("Calendar view", { exact: true })
    .selectOption("Week");
}

async function dragTo(page: Page, stopId: string, date: string, hour: number, minute = 0) {
  const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
  await calendar
    .locator(`[data-calendar-stop-id="${stopId}"]`)
    .dragTo(calendar.locator(`[data-calendar-date="${date}"]`), {
      targetPosition: { x: 20, y: ((hour * 60 + minute) / 60) * 46 + 1 },
    });
}

const read = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));

test("calendar dragging changes one accepted visit, focuses it, persists and undoes; overlap rejects", async ({
  page,
}) => {
  const trip = fixture();
  const stop = trip.stops[0]!;
  await open(page, trip);
  const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
  await dragTo(page, stop.id, "2027-03-02", 8);
  await expect(calendar.getByRole("status")).toContainText("Visit moved to Day 2 at 08:00");
  const moved = await read(page);
  expect(moved.stops.find((item: { id: string }) => item.id === stop.id)).toMatchObject({
    dayId: "day-2",
    startTime: "08:00",
    placeId: stop.placeId,
    durationMinutes: stop.durationMinutes,
  });
  expect(moved.stops.filter((item: { id: string }) => item.id !== stop.id)).toEqual(
    trip.stops.filter((item) => item.id !== stop.id),
  );
  await expect(calendar.locator(`[data-calendar-stop-id="${stop.id}"]`)).toBeFocused();
  await page.reload();
  expect((await read(page)).stops).toEqual(moved.stops);
  await page.getByRole("button", { name: "More trip options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo last change", exact: true }).click();
  expect((await read(page)).stops).toEqual(trip.stops);
  await page.getByRole("button", { name: /^Calendar/ }).click();
  await calendar.getByLabel("Calendar view", { exact: true }).selectOption("Week");
  const beforeRejected = await read(page);
  await dragTo(page, stop.id, "2027-03-02", 9, 30);
  await expect(calendar.getByRole("alert")).toContainText(/overlap/i);
  expect(await read(page)).toEqual(beforeRejected);
});

for (const mode of ["locked", "cross-city"] as const) {
  test(`calendar dragging respects the ${mode} domain boundary`, async ({ page }) => {
    const trip = fixture(mode);
    await open(page, trip);
    await dragTo(page, trip.stops[0]!.id, "2027-03-02", 8);
    const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
    await expect(calendar.getByRole("alert")).toContainText(
      mode === "locked" ? "Unlock this visit" : "another city",
    );
    expect(await read(page)).toEqual(trip);
  });
}
