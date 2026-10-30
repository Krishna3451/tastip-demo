import { expect, test } from "@playwright/test";

test("guided taste choices and feedback drive a fresh ranked draft", async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: false } } }),
  );
  await page.route("**/api/taste/search", (route) =>
    route.fulfill({
      json: {
        provider: "qloo",
        results: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            name: "Fixture Film",
            type: "urn:entity:movie",
          },
        ],
      },
    }),
  );
  let requestCount = 0;
  await page.route("**/api/taste", async (route) => {
    const body = route.request().postDataJSON();
    expect(body.entityIds).toEqual(["00000000-0000-4000-8000-000000000001"]);
    expect(body.categories).toEqual(requestCount === 0 ? ["culture", "shop"] : []);
    expect(body.excludedIds).toEqual(requestCount === 0 ? [] : ["place-1"]);
    const places = [1, 2, 3, 4]
      .filter((rank) => requestCount === 0 || rank !== 1)
      .map((rank) => ({
        id: `place-${rank}`,
        name: `Studio fixture ${rank}`,
        category: "culture",
        description: "Explicit synthetic contract fixture.",
        lat: 38.72,
        lng: -9.13,
        source: "qloo",
        taste: { queryId: `query-${requestCount}`, rank },
        practical: { hours: "unknown", cost: "unknown" },
      }));
    requestCount++;
    await route.fulfill({ json: { provider: "qloo", selected: places, warnings: [] } });
  });
  await page.goto("/studio");
  await page.getByRole("button", { name: "Find my kind of places" }).click();
  const studio = page.getByRole("dialog", { name: "Create your taste-led trip" });
  await studio.getByLabel("Search a cultural favorite").fill("Fixture Film");
  await studio.getByRole("button", { name: "Search favorites" }).click();
  await studio.getByRole("button", { name: /Fixture Film.*movie/ }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(studio.getByRole("heading")).toContainText("What draws you");
  await studio.getByRole("button", { name: "Art, stories & little bookshops" }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: "Build with my taste" }).click();
  await expect(studio).not.toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await page.getByRole("button", { name: /Studio fixture 1/ }).click();
  await expect(page.getByText(/Favorites saved with this trip: Fixture Film/)).toBeVisible();
  await page.getByRole("button", { name: "Less like this" }).click();
  await expect(page.getByRole("button", { name: "Less like this" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.reload();
  await page.getByRole("button", { name: "Rebuild with taste" }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: "A little of everything" }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await studio.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(studio.getByText(/previously disliked place/)).toBeVisible();
  await studio.getByRole("button", { name: "Build with my taste" }).click();
  await expect(studio).not.toBeVisible();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await expect(page.getByRole("button", { name: /Studio fixture 1/ })).toHaveCount(0);
  expect(requestCount).toBe(2);
});

test("taste interview closes by Escape and restores focus", async ({ page }) => {
  await page.goto("/studio");
  const trigger = page.getByRole("button", { name: "Find my kind of places" });
  await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
