import { expect, test } from "@playwright/test";
import {
  createTripFromPlaces,
  DEFAULT_BRIEF,
  DESTINATIONS,
  type Place,
} from "../../packages/domain/src";

const collectionId = "00000000-0000-4000-8000-000000000042";
const collectionName = "Synthetic café collection";
const favorite = {
  id: "00000000-0000-4000-8000-000000000043",
  name: "Synthetic collection artist",
  type: "urn:entity:artist",
};
const candidate: Place = {
  id: "collection-discovery-fixture-place",
  destinationId: "lisbon",
  name: "Synthetic collection café",
  description: "Synthetic Qloo browser contract fixture, not a real venue.",
  category: "cafe",
  lat: 38.7223,
  lng: -9.1393,
  source: "qloo",
  taste: { queryId: "collection-discovery-fixture-query", rank: 7, score: 0.42 },
  practical: { hours: "unknown", cost: "unknown" },
};

for (const width of [375, 1440])
  test(`guest collection discovery preserves membership, source and trip while rename/restore survives at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const trip = createTripFromPlaces(
      {
        ...DEFAULT_BRIEF,
        days: 2,
        tasteProfile: { seeds: [favorite], dayStyle: "Cafés and culture", categories: [] },
      },
      [],
    );
    await page.route("**/api/account", (route) => route.fulfill({ json: { account: null } }));
    await page.route("**/api/health", (route) =>
      route.fulfill({ json: { providers: { qloo: true, openai: false } } }),
    );
    let recommendations = 0;
    let accountSavedCalls = 0;
    await page.route("**/api/saved", (route) => {
      accountSavedCalls++;
      return route.fulfill({
        status: 401,
        json: { error: { message: "Guests have device saves" } },
      });
    });
    await page.route("**/api/taste", async (route) => {
      recommendations++;
      expect(route.request().postDataJSON()).toMatchObject({
        destinationId: "lisbon",
        entityIds: [favorite.id],
      });
      await route.fulfill({
        json: {
          provider: "qloo",
          queryId: candidate.taste!.queryId,
          selected: [candidate],
          warnings: [],
        },
      });
    });
    await page.addInitScript(
      ({ trip, collectionId, collectionName }) => {
        if (!localStorage.getItem("tastip.trip.v1"))
          localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
        if (!localStorage.getItem("tastip.reference.saved:guest"))
          localStorage.setItem("tastip.reference.saved:guest", "[]");
        if (!localStorage.getItem("tastip.reference.collections:guest"))
          localStorage.setItem(
            "tastip.reference.collections:guest",
            JSON.stringify([{ id: collectionId, name: collectionName, placeIds: [] }]),
          );
      },
      { trip, collectionId, collectionName },
    );

    await page.goto(`/saved?collection=${collectionId}`);
    await expect(page.getByRole("heading", { name: collectionName, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Find more places", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/explore\\?collection=${collectionId}$`));
    await expect(
      page.getByRole("region", { name: "Collection discovery", exact: true }),
    ).toContainText(collectionName);
    await page.getByRole("button", { name: "Restaurants", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`collection=${collectionId}.*type=restaurant`));
    await page.reload();
    await expect(
      page.getByRole("region", { name: "Collection discovery", exact: true }),
    ).toContainText(collectionName);
    await expect(page.getByRole("button", { name: "Restaurants", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page
      .getByRole("region", { name: "Personal recommendations", exact: true })
      .getByRole("button", { name: "Find places", exact: true })
      .click();
    await page.getByRole("button", { name: `View ${candidate.name}`, exact: true }).click();
    const detail = page.getByRole("dialog", { name: candidate.name, exact: true });
    await expect(detail.getByRole("button", { name: "Add to trip", exact: true })).toHaveCount(0);
    await detail.getByRole("button", { name: `Add to ${collectionName}`, exact: true }).click();
    await expect(
      detail.getByRole("button", { name: `In ${collectionName}`, exact: true }),
    ).toBeDisabled();
    await detail.getByRole("button", { name: "Close", exact: true }).click();
    await expect(
      page.getByRole("button", { name: `${candidate.name} is in ${collectionName}`, exact: true }),
    ).toBeDisabled();
    const workspace = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
    );
    expect(workspace.places).toEqual([
      { place: candidate, destination: DESTINATIONS.find((city) => city.id === "lisbon") },
    ]);
    expect(workspace.collections).toEqual([
      { id: collectionId, name: collectionName, placeIds: [candidate.id] },
    ]);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    expect(recommendations).toBe(1);
    expect(accountSavedCalls).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.getByRole("button", { name: "Stays", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Collection stays are not available yet", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: /Add.*stay|Find lodging/ })).toHaveCount(0);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    await page.getByRole("button", { name: "Experiences", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`collection=${collectionId}.*type=experience`));
    await page.getByRole("button", { name: "Back to collection", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/saved\\?collection=${collectionId}$`));
    await expect(
      page.getByRole("button", { name: `View ${candidate.name}`, exact: true }),
    ).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { name: collectionName, exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: `View ${candidate.name}`, exact: true }),
    ).toBeVisible();

    await page.getByRole("button", { name: `Options for ${collectionName}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename collection", exact: true });
    const renamed = "Synthetic Lisbon keeps";
    await rename.getByLabel("Collection name", { exact: true }).fill(renamed);
    await rename.getByRole("button", { name: "Update", exact: true }).click();
    await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/saved\\?collection=${collectionId}$`));
    await page.getByRole("button", { name: `Options for ${renamed}`, exact: true }).click();
    await page.getByRole("menuitem", { name: "Remove collection", exact: true }).click();
    await expect(page).toHaveURL(/\/saved$/);
    await expect(
      page.getByRole("button", { name: "Restore collection", exact: true }),
    ).toBeVisible();
    let afterRemoval = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
    );
    expect(afterRemoval.collections).toEqual([]);
    expect(afterRemoval.places[0].place).toEqual(candidate);

    // Restore only the removed collection, retaining a collection created since removal.
    await page.getByRole("button", { name: "Create", exact: true }).click();
    const create = page.getByRole("dialog", { name: "Create a collection", exact: true });
    await create.getByLabel("Name", { exact: true }).fill("Another synthetic collection");
    await create.getByRole("button", { name: "Create", exact: true }).click();
    await page.getByRole("button", { name: "Restore collection", exact: true }).click();
    afterRemoval = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
    );
    expect(afterRemoval.collections).toHaveLength(2);
    expect(
      afterRemoval.collections.find((collection: { id: string }) => collection.id === collectionId),
    ).toEqual({ id: collectionId, name: renamed, placeIds: [candidate.id] });
    expect(
      afterRemoval.collections.some(
        (collection: { name: string }) => collection.name === "Another synthetic collection",
      ),
    ).toBe(true);
    expect(afterRemoval.places[0].place.taste).toEqual(candidate.taste);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    await page.reload();
    await page
      .getByRole("button", { name: new RegExp(renamed) })
      .filter({ has: page.locator("strong", { hasText: renamed }) })
      .click();
    await expect(
      page.getByRole("button", { name: `View ${candidate.name}`, exact: true }),
    ).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/saved\\?collection=${collectionId}$`));
  });
