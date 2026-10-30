import { expect, test } from "@playwright/test";

for (const width of [375, 768, 1440]) {
  test(`entry and itinerary fit a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/studio");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("A trip that");
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Lisbon");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page.getByRole("region", { name: "Day itinerary" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}

test("direct edits, pins, undo and browser persistence share one trip", async ({ page }) => {
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /Demo · Slow Morning Café/ }).click();
  await page.getByRole("button", { name: "Keep this place", exact: true }).click();
  await page.getByRole("button", { name: "Remove from day", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Unpin" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toBeVisible();
  await page.getByRole("button", { name: "Place pinned", exact: true }).click();
  await page.getByLabel("Visit start time").fill("10:00");
  await page.getByRole("button", { name: "Update visit", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "10:00",
  );
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toContainText(
    "09:30",
  );
  await page.getByRole("button", { name: "Remove from day", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toHaveCount(0);
  await page.reload();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: /Demo · Slow Morning Café/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Demo · Courtyard Art House/ })).toBeVisible();
});

test("provider failure stays an error without a fake assistant reply", async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo: false }, mode: "demo" } }),
  );
  await page.route("**/api/chat", (route) =>
    route.fulfill({
      status: 503,
      json: {
        error: {
          code: "PROVIDER_NOT_CONFIGURED",
          message: "Connect an OpenAI API key on the server.",
        },
      },
    }),
  );
  await page.goto("/studio");
  await page.getByRole("button", { name: "Talk through an idea" }).click();
  await page.getByLabel("Message your travel companion").fill("A quiet day in Kyoto");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Connect an OpenAI API key" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit and retry" })).toBeVisible();
});

test("canvas failure leaves a usable destination and sample flow", async ({ page }) => {
  await page.addInitScript(() => {
    const original = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (
      this: HTMLCanvasElement,
      ...args: Parameters<typeof original>
    ) {
      if (String(args[0]).includes("webgl")) return null;
      return original.apply(this, args);
    } as typeof original;
  });
  await page.goto("/studio");
  await page.getByLabel("Destination", { exact: true }).selectOption("kyoto");
  await page.getByRole("button", { name: "Explore my Kyoto" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Kyoto");
  await expect(page.getByRole("button", { name: "Day 1", exact: true })).toBeVisible();
});

test("confirmed favorites feed ranked candidates into the accepted draft", async ({ page }) => {
  // Browser contract fixture only: this test makes no authenticated Qloo request.
  await page.route("**/api/health", (route) =>
    route.fulfill({
      json: { providers: { openai: false, qloo: true }, mode: "demo" },
    }),
  );
  await page.route("**/api/taste/search", (route) =>
    route.fulfill({
      json: {
        provider: "qloo",
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
  const places = [3, 1, 2, 4].map((rank) => ({
    id: `contract-place-${rank}`,
    name: `Contract fixture ${rank}`,
    category: "cafe",
    description: "Synthetic browser contract fixture, not a live recommendation.",
    lat: 38.72,
    lng: -9.13,
    source: "qloo",
    taste: { queryId: "contract-query", rank },
    practical: { hours: "unknown", cost: "unknown" },
  }));
  await page.route("**/api/taste", async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      entityIds: ["00000000-0000-4000-8000-000000000001"],
      destinationId: "lisbon",
    });
    await route.fulfill({
      json: { provider: "qloo", queryId: "contract-query", places, selected: places, warnings: [] },
    });
  });
  await page.goto("/studio");
  await page.locator("summary").filter({ hasText: "Tune your trip with Qloo" }).click();
  await page.getByLabel("Search a cultural favorite").fill("Fixture Artist");
  await page.getByRole("button", { name: "Search favorites" }).click();
  await page.getByRole("button", { name: /Fixture Artist.*artist/ }).click();
  await page.getByRole("button", { name: "Build with my taste" }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  const rows = page.getByRole("region", { name: "Day itinerary" }).getByRole("button");
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toContainText("Contract fixture 1");
  await expect(rows.nth(2)).toContainText("Contract fixture 3");
  await expect(page.getByText("Qloo draft", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Day 3", exact: true }).click();
  await expect(page.getByText("No visits scheduled for this day.")).toBeVisible();
});

test("dated multi-city route persists, protects city visits and supports undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Edit dates & cities" }).click();
  await page.getByLabel("Trip start date").fill("2028-02-28");
  await page.getByRole("button", { name: "Add city", exact: true }).click();
  await page.getByLabel("City 2", { exact: true }).selectOption("porto");
  await page.getByLabel("Days in city 2").fill("2");
  await page.getByLabel("Transport to city 2").selectOption("train");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  const route = page.getByRole("region", { name: "Dates and city route" });
  await expect(route).toContainText("5 days / 4 nights");
  await expect(route).toContainText("Lisbon → Porto");
  await page.getByRole("button", { name: "Day 4", exact: true }).click();
  await expect(route).toContainText("Day 4 · Porto");
  await expect(route).toContainText("2028-03-02");
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByText("No visits scheduled for this day.")).toBeVisible();
  await page.reload();
  await expect(route).toContainText("Lisbon → Porto");
  await page.getByRole("button", { name: "Edit dates & cities" }).click();
  await page.getByLabel("Days in city 1").fill("1");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "another city" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel route changes" }).click();
  await page.getByRole("button", { name: "Edit dates & cities" }).click();
  await page.getByLabel("Trip start date").fill("2028-03-10");
  await page.getByRole("button", { name: "Save route", exact: true }).click();
  await expect(route).toContainText("2028-03-10 — 2028-03-14");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(route).toContainText("2028-02-28 — 2028-03-03");
  expect(errors).toEqual([]);
});
