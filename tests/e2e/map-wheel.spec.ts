import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTripFromPlaces, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import { applyTripCommand } from "../../packages/domain/src/trip";

function wheelTrip() {
  const trip = createTripFromPlaces({ ...DEFAULT_BRIEF, days: 1 }, []);
  const result = applyTripCommand(trip, {
    id: "synthetic-wheel-pins",
    baseVersion: trip.version,
    operations: [0, 1].flatMap((index) => [
      {
        type: "set-own-place" as const,
        place: {
          id: `traveler:wheel-${index}`,
          destinationId: "lisbon",
          name: `Synthetic wheel pin ${index + 1}`,
          description: "Synthetic map interaction fixture, not a real venue.",
          category: "outdoors" as const,
          lat: 38.72 + index * 0.005,
          lng: -9.14 + index * 0.005,
          source: "traveler" as const,
          practical: { hours: "unknown" as const, cost: "unknown" as const },
        },
      },
      {
        type: "add-stop" as const,
        stop: {
          id: `wheel-visit-${index}`,
          dayId: "day-1",
          placeId: `traveler:wheel-${index}`,
          startTime: index ? "17:00" : "15:00",
          durationMinutes: 45,
          pinned: false,
          timeLocked: false,
        },
      },
    ]),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.trip;
}

async function centers(map: Locator) {
  return map.locator(".leaflet-overlay-pane path.leaflet-interactive").evaluateAll((paths) =>
    paths.map((path) => {
      const box = path.getBoundingClientRect();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }),
  );
}

async function zoomAtPin(page: Page, map: Locator, reduced: boolean) {
  await map.scrollIntoViewIfNeeded();
  const before = await centers(map);
  expect(before.length).toBeGreaterThan(0);
  const tileZoom = () =>
    map
      .locator("img.leaflet-tile")
      .evaluateAll((tiles) =>
        Math.max(
          ...tiles.map((tile) =>
            Number(new URL((tile as HTMLImageElement).src).pathname.split("/")[1]),
          ),
        ),
      );
  const initialTileZoom = await tileZoom();
  const [anchor, second] = before;
  if (!anchor) throw new Error("Expected a geographic anchor pin");
  await page.mouse.move(anchor.x, anchor.y);
  // Leaflet 1.9 divides pixel deltas by DPR on Linux Chrome and 3 * DPR on
  // macOS. -120 therefore jumps two zoom levels on Linux, clipping the second
  // pin out of SVG bounds. A -40 gesture exercises one real wheel-zoom step on
  // both platforms, keeping both geographic anchors available for comparison.
  await page.mouse.wheel(0, -40);
  if (!reduced) await expect(map.locator(".leaflet-map-pane")).toHaveClass(/leaflet-zoom-anim/);
  await expect.poll(tileZoom).toBe(initialTileZoom + 1);
  await expect
    .poll(async () => {
      const after = await centers(map);
      if (!second) {
        // New tile coordinates prove the single-pin picker changed geographic zoom.
        return (await tileZoom()) > initialTileZoom;
      }
      const [firstAfter, secondAfter] = after;
      if (!firstAfter || !secondAfter) return false;
      return (
        Math.hypot(secondAfter.x - firstAfter.x, secondAfter.y - firstAfter.y) >
        1.8 * Math.hypot(second.x - anchor.x, second.y - anchor.y)
      );
    })
    .toBe(true);
  await expect(map.locator(".leaflet-map-pane")).not.toHaveClass(/leaflet-zoom-anim/);
  const [after] = await centers(map);
  if (!after) throw new Error("The geographic anchor pin disappeared after zooming");
  expect(Math.hypot(after.x - anchor.x, after.y - anchor.y)).toBeLessThan(3);
  await expect(map.getByRole("link", { name: "OpenStreetMap" })).toBeVisible();
}

for (const [platform, width, reduced] of [
  ["MacIntel", 1440, false],
  ["MacIntel", 375, true],
  ["Linux x86_64", 1440, false],
  ["Linux x86_64", 375, true],
] as const) {
  test(`wheel zoom anchors geographic pins and keeps the draft unchanged at ${width}px (${platform})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: reduced ? "reduce" : "no-preference" });
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    await page.addInitScript(
      ({ trip, platform }) => {
        // Leaflet reads navigator.platform at module initialization; exercise both
        // native normalization branches regardless of the runner's operating system.
        Object.defineProperty(navigator, "platform", { value: platform });
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      },
      { trip: wheelTrip(), platform },
    );
    await page.goto("/studio");
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    await page.getByRole("button", { name: "Map this day", exact: true }).click();
    const map = page.getByRole("application", {
      name: "Geographic map of this day’s real places",
      exact: true,
    });
    await expect(map.locator(".leaflet-overlay-pane path.leaflet-interactive")).toHaveCount(2);
    const before = await page.evaluate(() => localStorage.getItem("tastip.trip.v1"));
    await zoomAtPin(page, map, reduced);
    await map.locator(".leaflet-overlay-pane path.leaflet-interactive").first().click();
    const detail = page.getByRole("complementary", {
      name: "Synthetic wheel pin 1 visit details",
      exact: true,
    });
    await expect(detail).toBeVisible();
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await page.getByRole("button", { name: "Open day timeline", exact: true }).click();
    await page.getByRole("button", { name: "Add to this day", exact: true }).click();
    await page.getByRole("button", { name: "Add a place I know", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add your own place and pin", exact: true });
    await dialog.getByRole("button", { name: "Use map center as pin", exact: true }).click();
    const picker = dialog.getByRole("application", {
      name: "Choose your place location near Lisbon",
      exact: true,
    });
    await expect(picker.locator(".leaflet-overlay-pane path.leaflet-interactive")).toHaveCount(1);
    const box = await picker.boundingBox();
    if (!box) throw new Error("Expected a visible pin picker");
    await picker.click({ position: { x: box.width * 0.35, y: box.height * 0.55 } });
    await zoomAtPin(page, picker, reduced);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem("tastip.trip.v1"))).toBe(before);
  });
}
