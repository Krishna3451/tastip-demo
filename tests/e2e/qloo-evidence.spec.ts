import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF, type Trip } from "../../packages/domain/src";

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("The synthetic evidence fixture is incomplete.");
  return value;
}

function evidenceFixture(): Trip {
  const trip = createDemoTrip({
    ...DEFAULT_BRIEF,
    days: 2,
    tasteProfile: {
      seeds: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          name: "Synthetic film favorite",
          type: "urn:entity:movie",
        },
        {
          id: "00000000-0000-4000-8000-000000000002",
          name: "Synthetic book favorite",
          type: "urn:entity:book",
        },
        {
          id: "00000000-0000-4000-8000-000000000003",
          name: "Synthetic artist favorite",
          type: "urn:entity:artist",
        },
        {
          id: "00000000-0000-4000-8000-000000000004",
          name: "Synthetic podcast favorite",
          type: "urn:entity:podcast",
        },
      ],
      dayStyle: "A little of everything",
      categories: [],
    },
  });
  // Synthetic source records exercise provenance display without calling Qloo.
  const first = required(trip.stops.find((stop) => stop.dayId === "day-1"));
  const place = required(trip.places.find((item) => item.id === first.placeId));
  place.name = "Synthetic Qloo evidence café";
  place.description =
    "A synthetic Qloo-shaped record for evidence tests, not a live recommendation.";
  place.source = "qloo";
  place.taste = { queryId: "synthetic-later-place-query", rank: 71, score: 0.99 };
  first.selection = { queryId: "synthetic-original-visit-query", rank: 7, score: 0.42 };
  const later = required(trip.stops.find((stop) => stop.dayId === "day-2"));
  later.placeId = place.id;
  later.selection = { queryId: "synthetic-return-visit-query", rank: 23 };
  const ownStop = required(trip.stops.filter((stop) => stop.dayId === "day-1")[2]);
  const ownPlace = required(trip.places.find((item) => item.id === ownStop.placeId));
  ownPlace.id = "traveler:synthetic-evidence-pin";
  ownPlace.name = "Synthetic traveler pin";
  ownPlace.source = "traveler";
  ownStop.placeId = ownPlace.id;
  trip.stops.push({
    ...first,
    id: "synthetic-visit-without-selection-evidence",
    startTime: "21:00",
    durationMinutes: 30,
    selection: undefined,
  });
  trip.places.push({
    ...place,
    id: "synthetic-unscheduled-qloo-idea",
    name: "Synthetic unscheduled Qloo idea",
    taste: { queryId: "synthetic-idea-query", rank: 19 },
  });
  return trip;
}

for (const width of [375, 1440]) {
  test(`Qloo disclosure shows original visit evidence and source counts without editing at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const initial = evidenceFixture();
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, initial);
    let recommendationRequests = 0;
    await page.route(/\/api\/taste(?:\/search)?(?:\?|$)/, (route) => {
      recommendationRequests++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "No live provider in this synthetic test." } },
      });
    });
    await page.goto("/studio?day=day-1");
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    await expect(journey.getByRole("list", { name: "Day 1 timeline", exact: true })).toBeVisible();
    const accepted = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    await page.getByText("Your taste in this trip", { exact: true }).click();
    const evidence = page.getByRole("region", {
      name: "Qloo recommendation evidence",
      exact: true,
    });
    await expect(
      evidence.getByRole("heading", { name: "Qloo in Day 1", exact: true }),
    ).toBeVisible();
    await expect(evidence).toContainText("2 Qloo visits in this day · 1 more idea");
    await expect(evidence).toContainText("1 fictional sample visit · 1 visit you added");
    await evidence.getByText("Favorites supplied", { exact: true }).click();
    const favorites = evidence.getByRole("list", {
      name: "Confirmed favorites in this trip",
      exact: true,
    });
    await expect(favorites.getByRole("listitem")).toHaveCount(4);
    await expect(favorites).toContainText("Synthetic podcast favorite");

    const visits = evidence.getByRole("list", {
      name: "Qloo visits selected for this day",
      exact: true,
    });
    const original = visits.getByRole("listitem").filter({ hasText: "original rank 7" });
    await original.getByText("Selection evidence", { exact: true }).click();
    await expect(original).toContainText("synthetic-original-visit-query");
    await expect(original).toContainText("7 within this response");
    await expect(visits).toContainText("Original visit selection was not recorded.");
    await expect(evidence).not.toContainText("synthetic-later-place-query");
    await expect(evidence).not.toContainText("rank 71");
    expect(await evidence.textContent()).not.toMatch(
      /\d+(?:\.\d+)?\s*%|\baffinity\b|\bmatch score\b/i,
    );

    await evidence.getByText("1 Qloo idea in Lisbon, not scheduled", { exact: true }).click();
    await expect(evidence).toContainText("Synthetic unscheduled Qloo idea");
    await expect(evidence).toContainText("synthetic-idea-query");
    await original
      .getByRole("button", { name: "Open Synthetic Qloo evidence café from Qloo", exact: true })
      .click();
    const detail = page.getByRole("complementary", {
      name: "Synthetic Qloo evidence café visit details",
      exact: true,
    });
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel("Visit start time", { exact: true })).toHaveValue("09:30");
    await expect(detail).toContainText("Recommendation rank 7.");
    await expect(
      detail.getByRole("region", { name: "This visit’s day and time", exact: true }),
    ).toContainText("Day 1");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    const missingSelection = visits.getByRole("listitem").filter({
      hasText: "Original visit selection was not recorded.",
    });
    await missingSelection
      .getByRole("button", { name: "Open Synthetic Qloo evidence café from Qloo", exact: true })
      .click();
    await expect(detail).toBeVisible();
    await expect(detail.getByLabel("Visit start time", { exact: true })).toHaveValue("21:00");
    await expect(detail).toContainText("Recommendation rank unavailable.");
    await expect(detail).toContainText("Original visit selection was not recorded.");
    await expect(detail).not.toContainText("rank 71");
    await expect(detail).not.toContainText("synthetic-later-place-query");
    await detail.getByRole("button", { name: "Close visit details", exact: true }).click();
    await journey
      .getByRole("navigation", { name: "Choose another day", exact: true })
      .getByRole("button", { name: "Open Day 2 schedule in Lisbon", exact: true })
      .click();
    await expect(
      evidence.getByRole("heading", { name: "Qloo in Day 2", exact: true }),
    ).toBeVisible();
    await expect(evidence).toContainText("1 Qloo visit in this day · 1 more idea");
    await expect(evidence).toContainText("2 fictional sample visits");
    const returnVisit = evidence
      .getByRole("list", { name: "Qloo visits selected for this day", exact: true })
      .getByRole("listitem");
    await returnVisit.getByText("Selection evidence", { exact: true }).click();
    await expect(returnVisit).toContainText("23 within this response");
    await expect(returnVisit).toContainText("synthetic-return-visit-query");
    await expect(evidence).not.toContainText("synthetic-original-visit-query");
    await expect(evidence).not.toContainText("synthetic-later-place-query");
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(accepted);
    expect(recommendationRequests).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
