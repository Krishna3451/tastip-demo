import { expect, test } from "@playwright/test";
import { DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";

for (const [prompt, days, partySize, origin] of [
  ["4 days in Lisbon and Porto for 2 travelers, with art, design and local food.", 4, 2, ""],
  ["From Delhi to Lisbon and Porto for 5 days with 3 people", 5, 3, "Delhi"],
] as const) {
  test(`explicit route review preserves duration, party and existing interests: ${prompt}`, async ({
    page,
  }) => {
    const destinationQueries: string[] = [];
    let paidCalls = 0;
    await page.route("**/api/health", (route) =>
      route.fulfill({ json: { providers: { qloo: false, openai: false } } }),
    );
    await page.route("**/api/taste", (route) => {
      paidCalls++;
      return route.abort();
    });
    await page.route("**/api/destinations", (route) => {
      destinationQueries.push(route.request().postDataJSON().query);
      return route.fulfill({
        json: {
          results: [
            {
              id: "synthetic-delhi",
              name: "Delhi",
              country: "India",
              lat: 28.65,
              lng: 77.22,
              timeZone: "Asia/Kolkata",
            },
          ],
        },
      });
    });
    await page.goto("/studio");
    await page.getByText("Describe a route", { exact: true }).click();
    await page.getByLabel("Describe your trip", { exact: true }).fill(prompt);
    await page.getByRole("button", { name: "Sketch my route", exact: true }).click();
    const review = page.getByRole("form", { name: "Review interpreted trip", exact: true });
    await expect(review).toBeVisible();
    await expect(review.getByLabel("Prompt city 1", { exact: true })).toContainText("Lisbon");
    await expect(review.getByLabel("Prompt city 2", { exact: true })).toContainText("Porto");
    await expect(review.getByLabel("Prompt days", { exact: true })).toHaveValue(String(days));
    expect(await page.evaluate(() => localStorage.getItem("tastip.trip.v1"))).toBeNull();
    await review.getByLabel("Prompt start date", { exact: true }).fill("2028-06-10");
    await review.getByRole("button", { name: "Use this route", exact: true }).click();
    await expect(page.getByText(/Route ready · Lisbon → Porto/)).toBeVisible();
    await page.getByRole("button", { name: "Start a blank plan", exact: true }).click();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const value = localStorage.getItem("tastip.trip.v1");
          return value ? JSON.parse(value).brief : null;
        }),
      )
      .toMatchObject({ days, partySize, origin, interests: DEFAULT_BRIEF.interests });
    const trip = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
    );
    expect(trip.route.stays.map((stay: { destinationId: string }) => stay.destinationId)).toEqual([
      "lisbon",
      "porto",
    ]);
    expect(trip.days).toHaveLength(days);
    expect(destinationQueries).toEqual(origin ? ["Delhi"] : []);
    expect(paidCalls).toBe(0);
  });
}

test("interest-only duration and unresolved non-city descriptions cannot become accepted routes", async ({
  page,
}) => {
  const queries: string[] = [];
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: false, openai: false } } }),
  );
  await page.route("**/api/destinations", (route) => {
    queries.push(route.request().postDataJSON().query);
    return route.fulfill({ json: { results: [] } });
  });
  await page.goto("/studio");
  await page.getByText("Describe a route", { exact: true }).click();
  const input = page.getByLabel("Describe your trip", { exact: true });
  for (const prompt of [
    "4 days of art, design and local food.",
    "4 days in definitely-not-a-city for 2 travelers",
  ]) {
    await input.fill(prompt);
    await page.getByRole("button", { name: "Sketch my route", exact: true }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: /Try a simple route|We couldn’t resolve/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("form", { name: "Review interpreted trip", exact: true }),
    ).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("tastip.trip.v1"))).toBeNull();
  }
  expect(queries).toEqual(["definitely-not-a-city"]);
});
