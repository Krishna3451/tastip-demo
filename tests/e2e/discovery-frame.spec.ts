import { expect, type Page, test } from "@playwright/test";
import { createTripFromPlaces, DEFAULT_BRIEF, type Place } from "../../packages/domain/src";

const favorite = {
  id: "00000000-0000-4000-8000-000000000085",
  name: "Synthetic warm-frame artist",
  type: "urn:entity:artist",
};
const candidate: Place = {
  id: "warm-frame-place",
  destinationId: "lisbon",
  name: "Synthetic warm-frame café",
  description: "Synthetic browser contract fixture, not a real venue.",
  source: "qloo",
  category: "cafe",
  lat: 38.72,
  lng: -9.13,
  taste: { queryId: "warm-frame-query", rank: 7 },
  practical: { hours: "unknown", cost: "unknown" },
};
async function mockGuest(page: Page) {
  await page.route("**/api/account", (route) => route.fulfill({ json: { account: null } }));
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: true, openai: false } } }),
  );
}
async function capture(page: Page, name: string) {
  if (process.env.TASTIP_CAPTURE_DISCOVERY) {
    const path = test.info().outputPath(`${name}.png`);
    await page.screenshot({ path });
    await test.info().attach(name, { path, contentType: "image/png" });
  }
}
async function fit(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const main = page.locator("main.tastip-discovery");
  await expect(main).toBeVisible();
  expect(await main.evaluate((element) => getComputedStyle(element).colorScheme)).toBe("dark");
  await expect(page.locator(".mt-sidebar")).toHaveCount(0);
}

for (const width of [375, 1440]) {
  test(`warm Explore, Saved and For you retain one trip and Qloo evidence at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockGuest(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const trip = createTripFromPlaces(
      {
        ...DEFAULT_BRIEF,
        tasteProfile: { seeds: [favorite], categories: [], dayStyle: "Cafés and culture" },
      },
      [],
    );
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, trip);
    await page.route("**/api/taste", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({
        destinationId: "lisbon",
        entityIds: [favorite.id],
      });
      await route.fulfill({ json: { selected: [candidate], warnings: [] } });
    });
    await page.goto("/explore?type=restaurant");
    await expect(
      page.getByRole("heading", { name: "Find your kind of places.", exact: true }),
    ).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await expect(nav.getByRole("link", { name: "Explore", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    for (const item of await nav.locator("a, button").all()) {
      const bounds = await item.boundingBox();
      expect(bounds?.height).toBeGreaterThanOrEqual(40);
    }
    await page
      .getByRole("region", { name: "Personal recommendations", exact: true })
      .getByRole("button", { name: "Find places", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: `View ${candidate.name}`, exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: `Save ${candidate.name}`, exact: true }).click();
    await expect(
      page.getByRole("button", { name: `Unsave ${candidate.name}`, exact: true }),
    ).toBeVisible();
    const attribution = page.getByRole("link", { name: "OpenStreetMap", exact: true });
    await expect(attribution).toHaveAttribute("href", "https://www.openstreetmap.org/copyright");
    expect(
      await page
        .locator(".mt-explore-map .leaflet-tile-pane")
        .evaluate((element) => getComputedStyle(element).filter),
    ).toBe("none");
    await fit(page);
    await capture(page, `explore-${width}`);

    await nav.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(nav.getByRole("link", { name: "Saved", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("heading", { name: "Your collections", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: /^Places/ }).click();
    await expect(page).toHaveURL(/saved\?view=places$/);
    await expect(
      page.getByRole("button", { name: `View ${candidate.name}`, exact: true }),
    ).toBeVisible();
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
    );
    expect(saved.places[0]).toMatchObject({
      place: candidate,
      destination: { id: "lisbon", name: "Lisbon" },
    });
    await fit(page);
    await capture(page, `saved-${width}`);

    await nav.getByRole("link", { name: "For you", exact: true }).click();
    await expect(nav.getByRole("link", { name: "For you", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(page.getByRole("button", { name: "Build my trip", exact: true })).toBeVisible();
    await fit(page);
    await capture(page, `discover-${width}`);
    await page.goBack();
    await expect(page).toHaveURL(/saved\?view=places$/);
    await expect(
      page.getByRole("button", { name: `View ${candidate.name}`, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    await page.getByRole("link", { name: "Tastip home", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Your floating day journey", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    expect(errors).toEqual([]);
  });

  test(`warm Chat history and account controls preserve the current page at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await mockGuest(page);
    await page.addInitScript(() => {
      if (!localStorage.getItem("tastip.reference.chats:guest"))
        localStorage.setItem(
          "tastip.reference.chats:guest",
          JSON.stringify([
            {
              id: "warm-frame-chat",
              title: "Synthetic Lisbon plans",
              updatedAt: 1,
              messages: [
                {
                  id: "warm-message",
                  role: "user",
                  text: "Synthetic history fixture: plan Lisbon.",
                },
              ],
            },
          ]),
        );
    });
    let replies = 0;
    await page.route("**/api/chat", (route) => {
      replies++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "No automatic sends in history." } },
      });
    });
    await page.goto("/saved?view=places");
    const originalUrl = page.url();
    const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await nav.getByRole("button", { name: "Chat", exact: true }).click();
    const chats = page.getByRole("dialog", { name: "Chats", exact: true });
    await expect(chats).toBeVisible();
    expect(page.url()).toBe(originalUrl);
    await chats
      .getByRole("button", { name: "Options for Synthetic Lisbon plans", exact: true })
      .click();
    await expect(chats.getByRole("menuitem", { name: "Rename", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(chats.getByRole("menuitem", { name: "Archive chat", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(chats.getByRole("menuitem", { name: "Rename", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(chats.getByRole("menuitem", { name: "Archive chat", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(
      chats.getByRole("button", { name: "Options for Synthetic Lisbon plans", exact: true }),
    ).toBeFocused();
    await chats
      .getByRole("button", { name: "Options for Synthetic Lisbon plans", exact: true })
      .click();
    await chats.getByRole("menuitem", { name: "Rename", exact: true }).click();
    const rename = page.getByRole("dialog", { name: "Rename chat", exact: true });
    await rename.getByLabel("Chat name", { exact: true }).fill("Synthetic Portugal notebook");
    await rename.getByRole("button", { name: "Update", exact: true }).click();
    await chats
      .getByRole("button", { name: "Options for Synthetic Portugal notebook", exact: true })
      .click();
    await chats.getByRole("menuitem", { name: "Archive chat", exact: true }).click();
    await expect(chats.getByRole("link", { name: /Synthetic Portugal notebook/ })).toHaveCount(0);
    await chats.getByRole("button", { name: "Archived", exact: true }).click();
    await chats
      .getByRole("button", { name: "Options for Synthetic Portugal notebook", exact: true })
      .click();
    await chats.getByRole("menuitem", { name: "Restore chat", exact: true }).click();
    await chats.getByRole("button", { name: "Back", exact: true }).click();
    await expect(chats.getByRole("link", { name: /Synthetic Portugal notebook/ })).toBeVisible();
    await capture(page, `history-${width}`);
    await chats.press("Escape");
    await expect(chats).toBeHidden();
    expect(page.url()).toBe(originalUrl);
    const account = page.getByRole("button", { name: "Guest Menu", exact: true });
    await account.click();
    await expect(page.getByRole("menu", { name: "Account menu", exact: true })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Trips", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "View profile", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowUp");
    await expect(page.getByRole("menuitem", { name: "Trips", exact: true })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Sign in", exact: true })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(page.getByRole("menuitem", { name: "Trips", exact: true })).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(account).toBeFocused();
    await account.click();
    await page.getByRole("menuitem", { name: "Sign in", exact: true }).click();
    const signIn = page.getByRole("dialog", { name: "Tastip account", exact: true });
    await expect(signIn).toBeVisible();
    await signIn.getByRole("button", { name: "Close account", exact: true }).click();
    expect(page.url()).toBe(originalUrl);
    expect(replies).toBe(0);
    await fit(page);
  });
}
