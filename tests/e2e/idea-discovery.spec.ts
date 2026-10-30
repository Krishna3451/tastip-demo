import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import type { OwnPlace } from "../../packages/domain/src/own-places";
import { applyTripCommand } from "../../packages/domain/src/trip";

for (const width of [375, 1440]) {
  test(`ideas can be found by name, source and category without losing edits at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.route("https://tile.openstreetmap.org/**", (route) => route.abort());
    const fixture = createDemoTrip({ ...DEFAULT_BRIEF, days: 1 });
    const qloo = fixture.places[3]!;
    qloo.name = "Café culture idea fixture";
    qloo.category = "culture";
    qloo.source = "qloo";
    qloo.taste = { queryId: "idea-search-fixture-query", rank: 7 };
    const longName = "x".repeat(300);
    const pin: OwnPlace = {
      id: "traveler:idea-search-fixture",
      destinationId: "lisbon",
      name: "Own riverside archive",
      category: "outdoors",
      description: "Traveler-entered search fixture",
      source: "traveler",
      lat: 38.72,
      lng: -9.14,
      practical: { hours: "unknown", cost: "unknown" },
    };
    const prepared = applyTripCommand(fixture, {
      id: "idea-search-fixture",
      baseVersion: fixture.version,
      operations: [
        { type: "set-own-place", place: pin },
        {
          type: "set-own-place",
          place: { ...pin, id: "traveler:long-idea-fixture", name: longName },
        },
      ],
    });
    if (!prepared.ok) throw new Error(prepared.error.message);
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, prepared.trip);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    if (width <= 620) await page.getByLabel("More planning views").selectOption("ideas");
    else await page.getByRole("button", { name: "Ideas", exact: true }).click();
    const ideas = page.getByRole("region", { name: "Ideas and day notes", exact: true });
    await expect(ideas.getByRole("status")).toHaveText("Showing 7 of 7 ideas for Lisbon.");
    const search = ideas.getByRole("searchbox", { name: "Search place ideas", exact: true });
    await search.fill("own riverside");
    await expect(ideas.getByRole("article")).toHaveCount(1);
    await ideas.getByLabel("Idea source", { exact: true }).selectOption("qloo");
    await expect(ideas.getByRole("article")).toHaveCount(0);
    await expect(ideas).toContainText("No ideas match these filters");
    await ideas.getByRole("button", { name: "Clear idea filters", exact: true }).click();
    await expect(search).toBeFocused();
    await search.fill("cafe");
    await ideas.getByLabel("Idea source", { exact: true }).selectOption("qloo");
    await ideas.getByLabel("Idea category", { exact: true }).selectOption("culture");
    await expect(ideas.getByRole("article")).toHaveCount(1);
    await expect(
      ideas.getByRole("heading", { name: "Café culture idea fixture", exact: true }),
    ).toBeVisible();
    await expect(ideas).toContainText("Qloo #7");
    await ideas.getByRole("button", { name: "Add a place I know", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Add your own place and pin", exact: true });
    await dialog
      .getByRole("textbox", { name: "Place name", exact: true })
      .fill("Fresh personal idea fixture");
    await dialog.getByRole("button", { name: "Use map center as pin", exact: true }).click();
    await dialog.getByRole("button", { name: "Keep as idea", exact: true }).click();
    await expect(ideas.getByRole("status")).toHaveText("Showing 8 of 8 ideas for Lisbon.");
    await expect(search).toHaveValue("");
    await expect(
      ideas.getByRole("heading", { name: "Fresh personal idea fixture", exact: true }),
    ).toBeVisible();
    await ideas
      .getByRole("button", { name: "Remove idea: Fresh personal idea fixture", exact: true })
      .click();
    await expect(search).toBeFocused();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(
      ideas.getByRole("heading", { name: "Fresh personal idea fixture", exact: true }),
    ).toBeVisible();
    await search.fill(longName.slice(0, 30));
    await ideas.getByLabel("Idea source", { exact: true }).selectOption("traveler");
    await expect(ideas.getByRole("article")).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await ideas.getByLabel("Idea visit start time", { exact: true }).fill("15:30");
    await ideas.getByRole("button", { name: "Add to Day 1", exact: true }).click();
    await page.getByRole("button", { name: "List", exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: new RegExp(longName.slice(0, 30)) }).click();
    const detail = page.getByRole("complementary", {
      name: `${longName} visit details`,
      exact: true,
    });
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("15:30–16:30 · Lisbon");
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("Europe/Lisbon");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await page.getByRole("button", { name: "Map", exact: true }).click();
    await expect(
      page.getByRole("application", {
        name: "Geographic map of this day’s real places",
        exact: true,
      }),
    ).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const source = await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null").places.find(
          (place: { id: string }) => place.id === id,
        ).taste,
      qloo.id,
    );
    expect(source).toEqual(qloo.taste);
    await page
      .getByRole("application", { name: "Geographic map of this day’s real places", exact: true })
      .getByRole("button", { name: "Zoom in", exact: true })
      .click();
    if (width <= 620) await page.getByLabel("More planning views").selectOption("calendar");
    else await page.getByRole("button", { name: "Calendar", exact: true }).click();
    const calendar = page.getByRole("region", { name: "Trip calendar", exact: true });
    await expect(calendar).toContainText("Traveler-added pin · location unverified");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await calendar.getByRole("button", { name: "Open Day 1 timeline", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Day 1 in Lisbon", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
