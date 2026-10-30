import { expect, type Locator, type Page, test } from "@playwright/test";
import { createTripFromPlaces, DEFAULT_BRIEF, type Trip } from "../../packages/domain/src";

async function guest(page: Page) {
  await page.route("**/api/account", (route) => route.fulfill({ json: { account: null } }));
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: false, qloo: false } } }),
  );
}
async function tripStorage(page: Page) {
  return page.evaluate(() => ({
    active: localStorage.getItem("tastip.trip.v1"),
    archive: localStorage.getItem("tastip.library.v1"),
  }));
}
async function renderedView(canvas: Locator) {
  await canvas.scrollIntoViewIfNeeded();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("The rendered globe surface is missing.");
  // The canvas extends past the clipped stage on phones. Compare its visible
  // geographic center, excluding overlaid controls and fractional clip edges.
  const size = Math.floor(Math.min(bounds.width, bounds.height) / 2);
  return canvas.page().screenshot({
    clip: {
      x: Math.round(bounds.x + (bounds.width - size) / 2),
      y: Math.round(bounds.y + (bounds.height - size) / 2),
      width: size,
      height: size,
    },
    style: ".globe-controls, .destination-coordinate { visibility: hidden !important; }",
  });
}
async function settledView(canvas: Locator) {
  let previous: Buffer | null = null;
  let stable = 0;
  await expect
    .poll(
      async () => {
        const current = await renderedView(canvas);
        stable = previous?.equals(current) ? stable + 1 : 0;
        previous = current;
        return stable;
      },
      { message: "The reduced-motion globe should settle instead of rendering continuous motion" },
    )
    .toBeGreaterThanOrEqual(2);
  if (!previous) throw new Error("The globe did not produce a rendered view.");
  return previous as Buffer;
}
async function mapPixels(canvas: Locator) {
  return canvas.evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The geographic fallback must retain its 2D map.");
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const counts = { land: 0, ocean: 0, marker: 0, route: 0 };
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const r = pixels[offset] ?? 0;
      const g = pixels[offset + 1] ?? 0;
      const b = pixels[offset + 2] ?? 0;
      if ((pixels[offset + 3] ?? 0) < 100) continue;
      // The current globe uses #174676 land and #07182f ocean, shaded from 42–100%.
      // Ratios retain that distinction across lighting, excluding bright coastlines and pins.
      if (b > 42 && r / b > 0.17 && r / b < 0.26 && g / b > 0.54 && g / b < 0.66) counts.land++;
      if (b > 15 && r / b > 0.1 && r / b < 0.17 && g / b > 0.45 && g / b < 0.56) counts.ocean++;
      // Selected pins are #e5f5ff; route intent is #b9e3f8, never fabricated geography.
      if (r > 220 && g > 235 && b > 245) counts.marker++;
      if (r > 160 && r < 210 && g > 205 && g < 238 && b > 230) counts.route++;
    }
    return counts;
  });
}

for (const width of [375, 1440]) {
  test(`globe keyboard and refocus preserve the selected trip brief at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guest(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const original = createTripFromPlaces(DEFAULT_BRIEF, [
      {
        id: "globe-contract-candidate",
        destinationId: "lisbon",
        name: "Synthetic globe contract place",
        description: "Synthetic browser fixture, not a real venue.",
        category: "cafe",
        lat: 38.72,
        lng: -9.13,
        source: "qloo",
        taste: { queryId: "globe-contract-query", rank: 7 },
        practical: { hours: "unknown", cost: "unknown" },
      },
    ]);
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, original);
    await page.goto("/");
    // Leaving the accepted draft explicitly archives it before the globe is shown.
    await page.getByRole("button", { name: "New trip", exact: true }).click();
    const world = page.getByRole("region", { name: "Explore destinations", exact: true });
    const canvas = world.locator(".globe-surface canvas");
    const focus = world.getByRole("button", { name: "Focus globe on Lisbon", exact: true });
    await expect(focus).toBeVisible();
    const before = await tripStorage(page);
    expect(before.active).toBeNull();
    expect(before.archive).toContain("globe-contract-query");
    const initial = await settledView(canvas);

    const west = world.getByRole("button", { name: "Rotate globe west", exact: true });
    await west.focus();
    await expect(west).toBeFocused();
    await west.press("ArrowLeft");
    await expect(focus).toHaveText("Refocus");
    await expect
      .poll(async () => !(await renderedView(canvas)).equals(initial), {
        message: "Keyboard rotation must change the rendered globe, not only its control label",
      })
      .toBe(true);
    await expect(page.getByLabel("Destination", { exact: true })).toHaveValue("lisbon");
    expect(await tripStorage(page)).toEqual(before);

    await west.press("ArrowUp");
    await west.press("Home");
    await expect(focus).toHaveText("Focus");
    await expect
      .poll(async () => (await renderedView(canvas)).equals(initial), {
        message: "Home should return to the selected destination's original view",
      })
      .toBe(true);
    await world.getByRole("button", { name: "Rotate globe east", exact: true }).click();
    await expect(focus).toHaveText("Refocus");
    await focus.click();
    await expect(focus).toHaveText("Focus");
    await expect.poll(async () => (await renderedView(canvas)).equals(initial)).toBe(true);
    expect(await tripStorage(page)).toEqual(before);

    await west.click();
    await expect(focus).toHaveText("Refocus");
    await page.getByLabel("Destination", { exact: true }).selectOption("kyoto");
    const kyotoFocus = world.getByRole("button", {
      name: "Focus globe on Kyoto",
      exact: true,
    });
    await expect(kyotoFocus).toHaveText("Focus");
    await expect(focus).toHaveCount(0);
    await expect(
      world.getByRole("img", { name: "Interactive globe focused on Kyoto.", exact: true }),
    ).toBeVisible();
    const kyoto = await settledView(canvas);
    expect(kyoto.equals(initial)).toBe(false);
    expect(await tripStorage(page)).toEqual(before);
    await expect(page.getByLabel("Number of days", { exact: true })).toHaveValue(
      String(DEFAULT_BRIEF.days),
    );
    await expect(page.getByLabel("Number of travelers", { exact: true })).toHaveValue(
      String(DEFAULT_BRIEF.partySize),
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await page.getByRole("button", { name: "Start a blank plan", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Your floating day journey", exact: true }),
    ).toBeVisible();
    const stored = await tripStorage(page);
    const accepted = JSON.parse(stored.active ?? "null") as Trip;
    expect(accepted.brief).toMatchObject({
      destinationId: "kyoto",
      days: DEFAULT_BRIEF.days,
      partySize: DEFAULT_BRIEF.partySize,
      pace: DEFAULT_BRIEF.pace,
      interests: DEFAULT_BRIEF.interests,
    });
    expect(stored.archive).toBe(before.archive);
    expect(errors).toEqual([]);
  });

  test(`geographic globe fallback keeps route intent and trip creation usable at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guest(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
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
    // Explicit destination-lookup fixture; the browser still reviews the actual route form.
    await page.route("**/api/destinations", async (route) => {
      expect(route.request().postDataJSON()).toMatchObject({ query: "Delhi" });
      await route.fulfill({
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
      });
    });
    await page.goto("/");
    const world = page.getByRole("region", { name: "Explore destinations", exact: true });
    const canvas = world.locator(".geographic-fallback canvas");
    await expect(canvas).toBeVisible();
    await expect(world.getByRole("button", { name: /Rotate globe/ })).toHaveCount(0);
    await expect(
      world.getByText(/Your destination and trip controls work without 3D/),
    ).toBeVisible();
    await expect.poll(async () => (await mapPixels(canvas)).land).toBeGreaterThan(100);
    const initial = await mapPixels(canvas);
    expect(initial.ocean).toBeGreaterThan(100);
    expect(initial.marker).toBeGreaterThan(0);
    expect((await tripStorage(page)).active).toBeNull();

    await page.getByText("Describe a route", { exact: true }).click();
    await page
      .getByLabel("Describe your trip", { exact: true })
      .fill("From Delhi to Lisbon and Porto for 5 days");
    await page.getByRole("button", { name: "Sketch my route", exact: true }).click();
    const review = page.getByRole("form", { name: "Review interpreted trip", exact: true });
    await review.getByLabel("Prompt start date", { exact: true }).fill("2028-06-10");
    await review.getByRole("button", { name: "Use this route", exact: true }).click();
    await expect(
      world.getByRole("img", {
        name: "Geographic globe focused on Lisbon. Route intent: Delhi to Lisbon to Porto.",
        exact: true,
      }),
    ).toBeVisible();
    await expect
      .poll(async () => (await mapPixels(canvas)).route, {
        message: "The fallback should visibly draw the reviewed route in addition to its pin",
      })
      .toBeGreaterThan(initial.route + 20);
    expect((await mapPixels(canvas)).marker).toBeGreaterThan(0);
    expect((await tripStorage(page)).active).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.getByRole("button", { name: "Start a blank plan", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "Your floating day journey", exact: true }),
    ).toBeVisible();
    const accepted = JSON.parse((await tripStorage(page)).active ?? "null") as Trip;
    expect(accepted.brief).toMatchObject({ destinationId: "lisbon", origin: "Delhi" });
    expect(accepted.route?.startDate).toBe("2028-06-10");
    expect(accepted.route?.stays.map((stay) => stay.destinationId)).toEqual(["lisbon", "porto"]);
    expect(accepted.days).toHaveLength(5);
    expect(errors).toEqual([]);
  });
}

for (const width of [375, 1440]) {
  test(`fresh planner chat stays beside the globe and preserves the hidden trip form at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guest(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let providerCalls = 0;
    await page.route(/\/api\/(?:chat|taste(?:\/search)?|destinations)(?:\?|$)/, (route) => {
      providerCalls++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "This interaction must not submit a provider request." } },
      });
    });
    await page.goto("/");
    const originalUrl = page.url();
    const draft = "Keep a quiet Kyoto idea with independent cafés and a slow morning.";
    await page.getByText("Describe a route", { exact: true }).click();
    const prompt = page.getByLabel("Describe your trip", { exact: true });
    await prompt.fill(draft);
    await page.getByLabel("Destination", { exact: true }).selectOption("kyoto");
    const originalPrompt = await prompt.elementHandle();
    if (!originalPrompt) throw new Error("The trip prompt must be mounted before opening chat.");
    const before = await tripStorage(page);
    expect(before.active).toBeNull();
    const headerChat = page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Chat", exact: true });
    await headerChat.click();
    await expect(headerChat).toHaveAttribute("aria-expanded", "true");
    const panel = page
      .locator(".entry-layout")
      .getByRole("region", { name: "Planner chat", exact: true });
    await expect(panel).toBeVisible();
    await expect(
      panel.getByRole("region", { name: "Travel conversation", exact: true }),
    ).toBeVisible();
    await expect(page.locator("#trip-prompt")).toBeHidden();
    expect(await originalPrompt.evaluate((element) => element.isConnected)).toBe(true);
    expect(page.url()).toBe(originalUrl);

    const world = page.getByRole("region", { name: "Explore destinations", exact: true });
    await expect(world).toBeVisible();
    const chatBounds = await panel.boundingBox();
    const globeBounds = await world.boundingBox();
    if (!chatBounds || !globeBounds)
      throw new Error("Chat and globe must both retain their layout.");
    if (width === 1440) {
      expect(chatBounds.x + chatBounds.width).toBeLessThanOrEqual(globeBounds.x + 1);
      expect(
        Math.min(chatBounds.y + chatBounds.height, globeBounds.y + globeBounds.height),
      ).toBeGreaterThan(Math.max(chatBounds.y, globeBounds.y));
    } else {
      const separate =
        chatBounds.y + chatBounds.height <= globeBounds.y + 1 ||
        globeBounds.y + globeBounds.height <= chatBounds.y + 1;
      expect(separate).toBe(true);
    }
    const focus = world.getByRole("button", { name: "Focus globe on Kyoto", exact: true });
    await focus.scrollIntoViewIfNeeded();
    await focus.focus();
    await expect(focus).toBeFocused();
    await focus.press("Home");
    await expect(focus).toHaveText("Focus");
    expect(providerCalls).toBe(0);
    expect(await tripStorage(page)).toEqual(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );

    await panel.getByRole("button", { name: "Close planner chat", exact: true }).click();
    await expect(headerChat).toHaveAttribute("aria-expanded", "false");
    await expect(panel).toBeHidden();
    await expect(prompt).toBeVisible();
    await expect(prompt).toHaveValue(draft);
    expect(
      await originalPrompt.evaluate(
        (element) => element.isConnected && element === document.getElementById("trip-prompt"),
      ),
    ).toBe(true);
    await expect(page.getByLabel("Destination", { exact: true })).toHaveValue("kyoto");
    expect(page.url()).toBe(originalUrl);
    expect(await tripStorage(page)).toEqual(before);
    expect(providerCalls).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(errors).toEqual([]);
  });
}
