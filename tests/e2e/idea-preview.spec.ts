import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import type { OwnPlace } from "../../packages/domain/src/own-places";
import { applyTripCommand } from "../../packages/domain/src/trip";

function fixture() {
  const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
  const qloo = initial.places[3]!;
  qloo.name = "Qloo preview fixture";
  qloo.description = "Synthetic venue details for inspecting an idea before scheduling it.";
  qloo.source = "qloo";
  qloo.taste = { queryId: "idea-preview-fixture-query", rank: 7 };
  qloo.facts = {
    source: "qloo",
    retrievedAt: "2026-10-29T00:00:00Z",
    imageUrl: "https://images.qloo.com/idea-preview-fixture.png",
    address: "Preview fixture address",
    website: "https://example.com/venue",
    menuUrl: "https://example.com/menu",
    specialtyDishes: "Synthetic listed dish",
    cuisine: "Fixture kitchen",
    hours: { wednesday: [{ opens: "10:00", closes: "18:00", closed: false }] },
  };
  const pin: OwnPlace = {
    id: "traveler:preview-fixture",
    name: `Personal preview fixture ${"x".repeat(250)}`,
    destinationId: "lisbon",
    category: "cafe",
    description: "Traveler-entered preview fixture.",
    source: "traveler",
    lat: 38.72,
    lng: -9.14,
    practical: { hours: "unknown", cost: "unknown" },
  };
  const result = applyTripCommand(initial, {
    id: "idea-preview-setup",
    baseVersion: initial.version,
    operations: [
      {
        type: "set-route",
        route: {
          startDate: "2028-05-10",
          stays: [{ id: "lisbon-stay", destinationId: "lisbon", days: 1 }],
          transfers: [],
        },
      },
      { type: "set-own-place", place: pin },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return { trip: result.trip, qloo, pin };
}

for (const width of [375, 1440]) {
  test(`idea previews expose source details and preserve search, schedule and private drafts at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const prepared = fixture();
    await page.route("https://images.qloo.com/**", (route) =>
      route.fulfill({
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      }),
    );
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, prepared.trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const read = () =>
      page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
    await page.goto("/studio");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("ideas");
    else await page.getByRole("button", { name: "Ideas", exact: true }).click();
    const before = await read();
    const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
    const search = ideas.getByRole("searchbox", { name: "Search place ideas", exact: true });
    const source = ideas.getByLabel("Idea source", { exact: true });
    const category = ideas.getByLabel("Idea category", { exact: true });
    const time = ideas.getByLabel("Idea visit start time", { exact: true });
    const duration = ideas.getByLabel("Idea visit duration", { exact: true });
    const note = ideas.getByLabel("Day notes", { exact: true });
    await time.fill("15:30");
    await duration.fill("45");
    await note.fill("Keep this unfinished private day draft.");
    await search.fill(prepared.qloo.name);
    await source.selectOption("qloo");
    await category.selectOption("outdoors");
    const preview = ideas.getByRole("button", {
      name: `Preview ${prepared.qloo.name}`,
      exact: true,
    });
    await preview.click();
    const dialog = page.getByRole("dialog", { name: prepared.qloo.name, exact: true });
    await expect(
      dialog.getByRole("heading", { name: prepared.qloo.name, exact: true }),
    ).toBeFocused();
    await expect(
      dialog.getByRole("region", { name: "Preview day context", exact: true }),
    ).toContainText("An idea for Day 1 · Lisbon");
    await expect(dialog).toContainText("2028-05-10 · Europe/Lisbon");
    await expect(dialog).toContainText("Image via Qloo");
    await expect(dialog).toContainText("Recommendation rank 7");
    const facts = dialog.getByRole("region", { name: "Sourced venue details", exact: true });
    await expect(facts).toContainText("Preview fixture address");
    await expect(facts).toContainText("Synthetic listed dish");
    await expect(facts).toContainText("Listed for this weekday: 10:00–18:00");
    await expect(facts.getByRole("link", { name: "Venue website ↗", exact: true })).toHaveAttribute(
      "href",
      "https://example.com/venue",
    );
    await expect(facts.getByRole("link", { name: "Venue menu ↗", exact: true })).toHaveAttribute(
      "href",
      "https://example.com/menu",
    );
    await facts.getByText("Provider-listed weekly hours", { exact: true }).click();
    await expect(facts.getByRole("definition").filter({ hasText: "10:00–18:00" })).toBeVisible();
    expect(await read()).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await dialog.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(preview).toBeFocused();
    await expect(search).toHaveValue(prepared.qloo.name);
    await expect(source).toHaveValue("qloo");
    await expect(category).toHaveValue("outdoors");
    await expect(time).toHaveValue("15:30");
    await expect(duration).toHaveValue("45");
    await expect(note).toHaveValue("Keep this unfinished private day draft.");
    await preview.click();
    await dialog.getByRole("button", { name: "Close place preview", exact: true }).click();
    await expect(preview).toBeFocused();
    await ideas.getByRole("button", { name: "Clear idea filters", exact: true }).click();
    await search.fill("Paper");
    await source.selectOption("demo");
    const demoPreview = ideas.getByRole("button", {
      name: "Preview Demo · Paper & Stories",
      exact: true,
    });
    await demoPreview.click();
    const demo = page.getByRole("dialog", { name: "Demo · Paper & Stories", exact: true });
    await expect(demo).toContainText("An original fictional venue");
    await expect(
      demo.getByRole("link", { name: "Open place on Google Maps", exact: true }),
    ).toHaveCount(0);
    await expect(
      demo.getByRole("region", { name: "Sourced venue details", exact: true }),
    ).toHaveCount(0);
    await demo.getByRole("button", { name: "Back to ideas", exact: true }).click();
    await expect(demoPreview).toBeFocused();
    await source.selectOption("traveler");
    await search.fill("Personal preview");
    const ownPreview = ideas.getByRole("button", {
      name: `Preview ${prepared.pin.name}`,
      exact: true,
    });
    await ownPreview.click();
    const own = page.getByRole("dialog", { name: prepared.pin.name, exact: true });
    await expect(own.getByRole("heading", { name: prepared.pin.name, exact: true })).toBeFocused();
    await expect(own).toContainText("Added by you");
    await expect(
      own.getByRole("link", { name: "Open place on Google Maps", exact: true }),
    ).toHaveAttribute("href", "https://www.google.com/maps/search/?api=1&query=38.72,-9.14");
    await expect(
      own.getByRole("region", { name: "Sourced venue details", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await own.getByRole("button", { name: "Back to ideas", exact: true }).click();
    await expect(ownPreview).toBeFocused();
    await expect(time).toHaveValue("15:30");
    await expect(duration).toHaveValue("45");
    await expect(note).toHaveValue("Keep this unfinished private day draft.");
    expect(await read()).toEqual(before);
    expect(errors).toEqual([]);
  });
}
