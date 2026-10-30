import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";

function fixture() {
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const cafe = trip.places[0]!;
  const gallery = trip.places[1]!;
  for (const [place, rank] of [
    [cafe, 1],
    [gallery, 2],
  ] as const) {
    place.source = "qloo";
    place.taste = { queryId: "visit-hours-fixture-query", rank };
    place.facts = {
      source: "qloo",
      retrievedAt: "2026-10-29T00:00:00Z",
      hours: {
        wednesday:
          rank === 1
            ? [{ opens: "11:00", closes: "12:00", closed: false }]
            : [{ opens: null, closes: null, closed: true }],
      },
    };
    trip.stops[rank - 1]!.selection = structuredClone(place.taste);
  }
  cafe.name = "Hours review café fixture";
  gallery.name = "Hours review gallery fixture";
  trip.stops[0]!.pinned = true;
  trip.stops[0]!.note = "Keep this private café reminder.";
  const result = applyTripCommand(trip, {
    id: "hours-review-dated-route",
    baseVersion: trip.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-05-10",
          stays: [{ id: "lisbon-stay", destinationId: "lisbon", days: 1 }],
          transfers: [],
        },
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return { trip: result.trip, cafe, gallery };
}

for (const width of [375, 1440]) {
  test(`listed-hour advisories lead to time review while preserving accepted intent at ${width}px`, async ({
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
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    const cafeCard = journey.getByRole("button", {
      name: `Open ${prepared.cafe.name}, 09:30`,
      exact: true,
    });
    const galleryCard = journey.getByRole("button", {
      name: `Open ${prepared.gallery.name}, 12:30`,
      exact: true,
    });
    await expect(cafeCard).toContainText("Check listed hours");
    await expect(cafeCard).toHaveAccessibleDescription(/Check listed hours/);
    await expect(galleryCard).toContainText("Listed closed for this weekday");
    await expect(
      journey
        .getByRole("button", { name: "Open Demo · Neighborhood Table, 17:00", exact: true })
        .locator(".visit-hours-badge"),
    ).toHaveCount(0);
    await cafeCard.click();
    const detail = page.getByRole("complementary", {
      name: `${prepared.cafe.name} visit details`,
      exact: true,
    });
    const review = detail.getByRole("region", { name: "Listed hours review", exact: true });
    await expect(review.getByRole("status")).toContainText("outside Qloo’s listed weekday hours");
    await review.getByRole("button", { name: "Review visit time", exact: true }).click();
    const time = detail.getByLabel("Visit start time", { exact: true });
    await expect(time).toBeFocused();
    await expect(time).toHaveValue("09:30");
    expect(await read()).toEqual(before);
    await time.fill("11:00");
    await expect(review).toBeVisible();
    expect(await read()).toEqual(before);
    await detail.getByRole("button", { name: "Update visit", exact: true }).click();
    await expect(review).toHaveCount(0);
    await expect(
      detail.getByText("Keep this private café reminder.", { exact: true }),
    ).toBeVisible();
    const saved = await read();
    expect(saved.stops.find((stop: { id: string }) => stop.id === before.stops[0].id)).toEqual({
      ...before.stops[0],
      startTime: "11:00",
    });
    expect(saved.stops.filter((stop: { id: string }) => stop.id !== before.stops[0].id)).toEqual(
      before.stops.filter((stop: { id: string }) => stop.id !== before.stops[0].id),
    );
    expect(saved.places).toEqual(before.places);
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    const updatedCard = journey.getByRole("button", {
      name: `Open ${prepared.cafe.name}, 11:00`,
      exact: true,
    });
    await expect(updatedCard).toBeFocused();
    await expect(updatedCard.locator(".visit-hours-badge")).toHaveCount(0);
    await expect(galleryCard).toContainText("Listed closed for this weekday");
    await page.reload();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await expect(updatedCard).toBeVisible();
    expect((await read()).stops).toEqual(saved.stops);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(cafeCard).toContainText("Check listed hours");
    expect((await read()).stops).toEqual(before.stops);
    await galleryCard.click();
    const galleryDetail = page.getByRole("complementary", {
      name: `${prepared.gallery.name} visit details`,
      exact: true,
    });
    await expect(
      galleryDetail.getByRole("region", { name: "Listed hours review", exact: true }),
    ).toContainText("Qloo lists this weekday as closed");
    await expect(galleryDetail).toContainText("Holiday exceptions are not checked");
    await galleryDetail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await expect(galleryCard).toBeFocused();
    expect((await read()).stops).toEqual(before.stops);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
