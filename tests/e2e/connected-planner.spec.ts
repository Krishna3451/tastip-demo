import { expect, test } from "@playwright/test";

test("route prompt, taste rhythm, second-city recommendations and ideas form one persisted trip", async ({
  page,
}) => {
  // Explicit synthetic provider responses. Separate live verification exercises the actual Qloo API.
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: false } } }),
  );
  await page.route("**/api/taste/search", (route) =>
    route.fulfill({
      json: {
        results: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Fixture Artist",
            type: "urn:entity:artist",
          },
        ],
      },
    }),
  );
  await page.route("**/api/destinations", (route) =>
    route.fulfill({
      json: {
        source: "open-meteo",
        results: [
          {
            id: "geonames-fixture-delhi",
            name: "Delhi",
            country: "India",
            lat: 28.65,
            lng: 77.22,
            timeZone: "Asia/Kolkata",
          },
        ],
      },
    }),
  );
  const seen: string[] = [];
  await page.route("**/api/taste", async (route) => {
    const body = route.request().postDataJSON();
    seen.push(body.destinationId);
    const city = body.destinationId;
    const selected = [5, 1, 8, 3, 12, 9, 15].map((rank) => ({
      id: `${city}-${rank}`,
      destinationId: city,
      name: `${city} contract place ${rank}`,
      category: "culture",
      description: "Synthetic end-to-end contract fixture, not a live venue.",
      lat: city === "porto" ? 41.15 : 38.72,
      lng: city === "porto" ? -8.62 : -9.13,
      source: "qloo",
      taste: { queryId: `${city}-query`, rank },
      practical: { hours: "unknown", cost: "unknown" },
    }));
    const lodgings = body.includeLodging
      ? [
          {
            id: `${city}-hotel`,
            destinationId: city,
            name: `${city} lodging contract fixture`,
            description: "Synthetic hotel fixture; no availability or reservation implied.",
            lat: city === "porto" ? 41.15 : 38.72,
            lng: city === "porto" ? -8.62 : -9.13,
            source: "qloo",
            taste: { queryId: `${city}-lodging-query`, rank: 49 },
          },
        ]
      : [];
    await route.fulfill({ json: { selected, lodgings, warnings: [] } });
  });
  await page.goto("/studio");
  await page.getByText("Describe a route", { exact: true }).click();
  await page.getByLabel("Describe your trip").fill("From Delhi to Lisbon and Porto for 5 days");
  await page.getByRole("button", { name: "Sketch my route" }).click();
  const review = page.getByRole("form", { name: "Review interpreted trip" });
  await expect(review).toBeVisible();
  await review.getByLabel("Prompt start date").fill("2028-06-10");
  await review.getByRole("button", { name: "Use this route" }).click();
  await expect(page.getByText(/Route ready · Lisbon → Porto/)).toBeVisible();
  await page.getByRole("button", { name: "Find my kind of places" }).click();
  const studio = page.getByRole("dialog", { name: "Create your taste-led trip" });
  await studio.getByLabel("Search a cultural favorite").fill("Fixture Artist");
  await studio.getByRole("button", { name: "Search favorites" }).click();
  await studio.getByRole("button", { name: /Fixture Artist.*artist/ }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: "A little of everything", exact: true }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: /Late starts & evenings/ }).click();
  await studio.getByRole("button", { name: "Vegetarian", exact: true }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: "Build with my taste" }).click();
  const generation = page.getByRole("dialog", { name: "Review your personal trip", exact: true });
  await generation.getByRole("button", { name: "Find my places", exact: true }).click();
  await generation.getByRole("button", { name: "Create this trip", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: /lisbon contract place 1/ })).toContainText(
    "11:00",
  );
  await page.getByRole("button", { name: "Day 4", exact: true }).click();
  await expect(page.getByRole("button", { name: /porto contract place 1/ })).toContainText("15:00");
  // Both cities are populated by the shared initial review. Explicit discovery can refill an opened slot.
  await page.getByRole("button", { name: /porto contract place 1/ }).click();
  await page.getByRole("button", { name: "Remove from day", exact: true }).click();
  await page.getByRole("button", { name: "Find places in Porto", exact: true }).click();
  await expect(page.getByText(/real candidates · .*new draft visits/)).toBeVisible();
  await page.getByRole("button", { name: /Add .* visits & keep ideas/ }).click();
  await expect(page.getByRole("button", { name: /porto contract place 1/ })).toContainText("15:00");
  await page.getByRole("button", { name: "Day 1", exact: true }).click();
  await expect(page.getByRole("button", { name: /lisbon contract place 1/ })).toContainText(
    "11:00",
  );
  await page.getByRole("button", { name: "Day 4", exact: true }).click();
  await page.getByRole("button", { name: /porto contract place 1/ }).click();
  await page.getByRole("button", { name: "Remove from day", exact: true }).click();
  await page.getByRole("button", { name: "Ideas", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "porto contract place 1", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Day title", { exact: true }).fill("An afternoon in Porto");
  await page.getByRole("button", { name: "Save day notes", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "An afternoon in Porto", exact: true }).click();
  await expect(page.getByRole("button", { name: /porto contract place 3/ })).toBeVisible();
  await page.getByRole("button", { name: "Stays", exact: true }).click();
  await page.getByLabel("Lodging city stay").selectOption("stay-2");
  await page.getByRole("button", { name: "Find stays in Porto", exact: true }).click();
  await page.getByRole("button", { name: "Keep this lodging idea", exact: true }).click();
  await expect(page.getByText(/1 night · not reserved/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: "Stays", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "porto lodging contract fixture", exact: true }),
  ).toBeVisible();
  expect(seen).toEqual(["lisbon", "porto", "porto", "porto"]);
});

test("reviewed local chat command edits actual draft and stale proposals cannot apply", async ({
  page,
}) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: "Chat", exact: true }).click();
  await page.getByRole("button", { name: "Keep my first place", exact: true }).click();
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByText("Review trip change", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Demo · Slow Morning Café/ }).click();
  await expect(page.getByRole("button", { name: "Keep this place", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close visit details", exact: true }).click();
  await page.getByRole("button", { name: "Apply change", exact: true }).click();
  await expect(page.getByText(/Applied · draft v2/)).toBeVisible();
  await page.getByRole("button", { name: /Demo · Slow Morning Café/ }).click();
  await expect(page.getByRole("button", { name: "Place pinned", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: "Keep this place", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close visit details", exact: true }).click();
  await page
    .getByLabel("Message your travel companion")
    .fill("Move Demo · Slow Morning Café at 10:00");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply change", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: /Demo · Slow Morning Café/ }).click();
  await page.getByRole("button", { name: "Keep this place", exact: true }).click();
  await expect(page.getByRole("button", { name: "Apply change", exact: true })).toBeDisabled();
});

test("invalid creation stays recoverable and editing confirmed duration clears its old route", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/studio");
  await page.getByLabel("Number of days").fill("0");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await expect(page.getByRole("status").filter({ hasText: "between 1 and 30 days" })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A trip that");
  await page.getByLabel("Number of days").fill("3");
  await page.getByText("Describe a route", { exact: true }).click();
  await page.getByLabel("Describe your trip").fill("Lisbon and Porto for 5 days");
  await page.getByRole("button", { name: "Sketch my route" }).click();
  const review = page.getByRole("form", { name: "Review interpreted trip" });
  await review.getByLabel("Prompt start date").fill("2028-06-10");
  await review.getByRole("button", { name: "Use this route" }).click();
  await page.getByLabel("Number of days").fill("2");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: "Day 3", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Day 2", exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("real-place map uses canonical coordinates and a failed driving provider stays an error", async ({
  page,
}) => {
  const places = [1, 2].map((rank) => ({
    id: `map-place-${rank}`,
    destinationId: "lisbon",
    name: `Synthetic map contract ${rank}`,
    category: "culture",
    description: "Synthetic map contract fixture.",
    lat: 38.72 + rank * 0.001,
    lng: -9.13,
    source: "qloo",
    taste: { queryId: "map-query", rank },
    practical: { hours: "unknown", cost: "unknown" },
  }));
  const trip = {
    id: "map-fixture-trip",
    version: 1,
    brief: {
      destinationId: "lisbon",
      origin: "",
      days: 1,
      partySize: 2,
      budget: null,
      currency: "EUR",
      pace: "balanced",
      interests: [],
    },
    places,
    days: [{ id: "day-1", label: "Day 1", date: null }],
    stops: places.map((place, index) => ({
      id: `visit-${index}`,
      placeId: place.id,
      dayId: "day-1",
      startTime: index ? "12:30" : "09:30",
      durationMinutes: 60,
      pinned: false,
      timeLocked: false,
    })),
    appliedCommandIds: [],
    commandLog: [],
    updatedAt: "2026-10-29T00:00:00Z",
  };
  await page.addInitScript(
    (value) => localStorage.setItem("tastip.trip.v1", JSON.stringify(value)),
    trip,
  );
  // Do not automate tile downloading from the public community tile server.
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
  await page.route("**/api/routes", (route) => {
    expect(route.request().postDataJSON().coordinates).toEqual(
      places.map((place) => [place.lng, place.lat]),
    );
    return route.fulfill({
      status: 503,
      json: {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          message: "Driving provider unavailable; no travel times assumed.",
        },
      },
    });
  });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Map", exact: true }).click();
  await expect(
    page.getByRole("application", { name: "Geographic map of this day’s real places" }),
  ).toBeVisible();
  await expect(page.getByText("OpenStreetMap", { exact: true })).toBeVisible();
  const handoff = page.getByRole("link", {
    name: "Directions from Synthetic map contract 1 to Synthetic map contract 2 in Google Maps",
    exact: true,
  });
  await expect(handoff).toHaveAttribute("href", /travelmode=walking/);
  await page.getByLabel("Google Maps travel mode").selectOption("transit");
  await expect(handoff).toHaveAttribute("href", /travelmode=transit/);
  await expect(handoff).toHaveAttribute("target", "_blank");
  await page.getByRole("button", { name: "Check driving route", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Driving provider unavailable" }),
  ).toBeVisible();
  await expect(page.getByText(/km · about/)).toHaveCount(0);
});
