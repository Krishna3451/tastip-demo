import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";

const imageHost = "https://images.qloo.com/";
const image = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

for (const width of [375, 1440]) {
  test(`timeline venue photos retain source credit, usable fallbacks and visit identity at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
    const first = trip.places[0]!;
    const broken = trip.places[1]!;
    const replacement = trip.places[3]!;
    for (const [place, rank, file] of [
      [first, 1, "fixture-photo.png"],
      [broken, 2, "fixture-broken.png"],
      [replacement, 4, "fixture-replacement.png"],
    ] as const) {
      place.source = "qloo";
      place.name = `Photo layout fixture ${rank}`;
      place.taste = { queryId: "timeline-photo-fixture-query", rank };
      place.facts = {
        source: "qloo",
        retrievedAt: "2026-10-29T00:00:00Z",
        imageUrl: imageHost + file,
      };
    }
    const requested: string[] = [];
    await page.route(`${imageHost}**`, (route) => {
      requested.push(route.request().url());
      expect(route.request().headers().referer).toBeUndefined();
      return route.request().url().includes("fixture-broken")
        ? route.fulfill({ status: 404, body: "Unavailable fixture image" })
        : route.fulfill({ contentType: "image/png", body: image });
    });
    await page.addInitScript((value) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(value));
    }, trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto("/studio");
    const before = await read();
    await page.getByRole("button", { name: "Day 1", exact: true }).click();
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    const firstCard = journey.getByRole("button", {
      name: `Open ${first.name}, 09:30`,
      exact: true,
    });
    await expect(firstCard).toContainText("Image via Qloo");
    await expect(firstCard).toHaveAccessibleDescription(
      "Selected around your taste · Image via Qloo",
    );
    await expect(firstCard.locator("img")).toHaveJSProperty("naturalWidth", 1);
    const brokenCard = journey.getByRole("button", {
      name: `Open ${broken.name}, 12:30`,
      exact: true,
    });
    await brokenCard.scrollIntoViewIfNeeded();
    await expect.poll(() => requested.includes(broken.facts!.imageUrl!)).toBe(true);
    await expect(brokenCard.locator("img")).toHaveCount(0);
    await expect(brokenCard.locator(".day-timeline-place-art > svg")).toBeVisible();
    await expect(brokenCard).not.toContainText("Image via Qloo");
    const sample = journey.getByRole("button", {
      name: "Open Demo · Neighborhood Table, 17:00",
      exact: true,
    });
    await expect(sample.locator("img")).toHaveCount(0);
    await expect(sample).toHaveAccessibleDescription("Fictional sample place");
    await expect(journey.locator(".day-timeline-summary")).toContainText("3h in visits");
    expect(await read()).toEqual(before);
    await brokenCard.click();
    const detail = page.getByRole("complementary", {
      name: `${broken.name} visit details`,
      exact: true,
    });
    await detail.getByLabel("Replacement place", { exact: true }).selectOption(replacement.id);
    await detail.getByRole("button", { name: "Replace place", exact: true }).click();
    const updatedDetail = page.getByRole("complementary", {
      name: `${replacement.name} visit details`,
      exact: true,
    });
    await updatedDetail.getByRole("button", { name: "Close visit details", exact: true }).click();
    const replaced = journey.getByRole("button", {
      name: `Open ${replacement.name}, 12:30`,
      exact: true,
    });
    await expect(replaced).toBeFocused();
    await expect(replaced).toContainText("Image via Qloo");
    await expect(replaced.locator("img")).toHaveJSProperty("naturalWidth", 1);
    expect(await replaced.getAttribute("data-stop-id")).toBe(before.stops[1].id);
    const saved = await read();
    expect(
      saved.stops.find((stop: { id: string }) => stop.id === before.stops[1].id),
    ).toMatchObject({
      placeId: replacement.id,
      startTime: "12:30",
      durationMinutes: 60,
      selection: replacement.taste,
    });
    expect(saved.stops.filter((stop: { id: string }) => stop.id !== before.stops[1].id)).toEqual(
      before.stops.filter((stop: { id: string }) => stop.id !== before.stops[1].id),
    );
    expect(saved.places).toEqual(before.places);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(brokenCard).toBeVisible();
    await expect(brokenCard.locator("img")).toHaveCount(0);
    await expect(brokenCard.locator(".day-timeline-place-art > svg")).toBeVisible();
    await expect(firstCard).toContainText("Image via Qloo");
    expect((await read()).stops).toEqual(before.stops);
    expect(errors).toEqual([]);
  });
}
