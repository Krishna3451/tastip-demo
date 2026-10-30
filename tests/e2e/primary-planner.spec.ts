import { expect, type Page, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF, type Trip } from "../../packages/domain/src";

async function storedTrip(page: Page): Promise<Trip> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}

for (const width of [375, 1440]) {
  test(`the primary globe creates day islands and keeps one trip across Explore and Saved at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    for (const path of ["/", "/home"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toContainText("A trip that");
      await expect(
        page.getByRole("region", { name: "Explore destinations", exact: true }),
      ).toBeVisible();
      await expect(page.getByLabel("Destination", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Explore my Lisbon Sample journey", exact: true }),
      ).toBeVisible();
    }
    await page
      .getByRole("button", { name: "Explore my Lisbon Sample journey", exact: true })
      .click();
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    await expect(journey.getByRole("group", { name: "Choose a day to explore" })).toBeVisible();
    await journey.getByRole("button", { name: "Day 2", exact: true }).click();
    await expect(
      journey.getByRole("heading", { name: "Day 2 in Lisbon", exact: true }),
    ).toBeVisible();
    await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toContainText(
      "Demo · Hilltop Garden",
    );
    const accepted = await storedTrip(page);
    const navigation = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await navigation.getByRole("link", { name: "Explore", exact: true }).click();
    await expect(page).toHaveURL(/\/explore(?:\?|$)/);
    expect(await storedTrip(page)).toEqual(accepted);

    await page.goto("/home?day=day-2");
    await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toBeVisible();
    await navigation.getByRole("link", { name: "Saved", exact: true }).click();
    await expect(page).toHaveURL(/\/saved(?:\?|$)/);
    await expect(
      page.getByRole("heading", { name: "Your collections", exact: true }),
    ).toBeVisible();
    expect(await storedTrip(page)).toEqual(accepted);

    await page.goto("/?day=day-2");
    await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toBeVisible();
    expect(await storedTrip(page)).toEqual(accepted);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });

  test(`the header Chat reviews a canonical edit and returns to its selected day island at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const initial = createDemoTrip({ ...DEFAULT_BRIEF, days: 2 });
    const stop = initial.stops.find((item) => item.dayId === "day-2")!;
    const place = initial.places.find((item) => item.id === stop.placeId)!;
    await page.addInitScript((trip) => {
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
    }, initial);
    await page.route("**/api/health", (route) =>
      route.fulfill({ json: { providers: { openai: true, qloo: false } } }),
    );
    let calls = 0;
    // Synthetic assistant transport only; the reviewed change uses the app's real trip commands.
    await page.route("**/api/chat", async (route) => {
      calls++;
      const request = route.request().postDataJSON();
      expect(request.trip).toMatchObject({ id: initial.id, version: initial.version });
      expect(request.trip.stops).toContainEqual(
        expect.objectContaining({ id: stop.id, dayId: "day-2" }),
      );
      await route.fulfill({
        json: {
          provider: "openai",
          message: "Review keeping this day-two visit in your trip.",
          proposal: {
            id: `primary-planner-pin-${width}`,
            tripId: initial.id,
            baseVersion: initial.version,
            summary: "Keep the selected day-two visit.",
            operations: [{ type: "pin-stop", stopId: stop.id, pinned: true }],
          },
        },
      });
    });
    await page.goto("/home?day=day-2");
    const journey = page.getByRole("region", { name: "Your floating day journey", exact: true });
    await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toBeVisible();
    const chat = page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Chat", exact: true });
    await expect(chat).toHaveAttribute("aria-expanded", "false");
    await chat.click();
    await expect(chat).toHaveAttribute("aria-expanded", "true");
    await expect(page).toHaveURL(/\/home\?day=day-2$/);
    const plannerChat = page.getByRole("region", { name: "Planner chat", exact: true });
    await expect(plannerChat).toBeVisible();
    expect(await storedTrip(page)).toEqual(initial);
    const fullConversation = plannerChat.getByRole("link", {
      name: "Full conversation",
      exact: true,
    });
    const fullHref = await fullConversation.getAttribute("href");
    if (!fullHref) throw new Error("The full conversation link is missing.");
    const href = new URL(fullHref, page.url());
    expect(href.pathname).toMatch(/^\/chat\/[^/]+$/);
    expect(href.pathname).not.toBe("/chat/new");
    expect(href.searchParams.get("trip")).toBe(initial.id);
    expect(href.searchParams.get("return")).toBe("planner");
    expect(href.searchParams.get("day")).toBe("day-2");
    await fullConversation.click();
    await expect(page).toHaveURL(href.href);
    const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
    await expect(conversation).toBeVisible();
    const chatPath = new URL(page.url()).pathname;
    const returnToTrip = page.getByRole("link", { name: "Trip", exact: true });
    await expect(returnToTrip).toHaveAttribute("href", "/?day=day-2");
    await conversation
      .getByLabel("Message your travel companion", { exact: true })
      .fill("Keep my day-two visit in the plan.");
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(conversation.getByText("Review trip change", { exact: true })).toBeVisible();
    expect((await storedTrip(page)).stops.find((item) => item.id === stop.id)?.pinned).toBe(false);
    await conversation.getByRole("button", { name: "Apply change", exact: true }).click();
    await expect.poll(async () => (await storedTrip(page)).version).toBe(initial.version + 1);
    const edited = await storedTrip(page);
    expect(edited.id).toBe(initial.id);
    expect(edited.stops.find((item) => item.id === stop.id)?.pinned).toBe(true);
    expect(calls).toBe(1);
    await returnToTrip.click();
    await expect(page).toHaveURL(/\/\?day=day-2$/);
    await expect(
      journey.getByRole("heading", { name: "Day 2 in Lisbon", exact: true }),
    ).toBeVisible();
    await journey
      .getByRole("button", { name: `Open ${place.name}, ${stop.startTime}`, exact: true })
      .click();
    await expect(page.getByRole("button", { name: "Place pinned", exact: true })).toBeVisible();
    expect(await storedTrip(page)).toEqual(edited);
    await page.reload();
    await expect(journey.getByRole("list", { name: "Day 2 timeline", exact: true })).toBeVisible();
    expect(await storedTrip(page)).toEqual(edited);
    const reopenedChat = page
      .getByRole("navigation", { name: "Main navigation", exact: true })
      .getByRole("button", { name: "Chat", exact: true });
    await reopenedChat.click();
    await expect(reopenedChat).toHaveAttribute("aria-expanded", "true");
    const reopenedFullConversation = page
      .getByRole("region", { name: "Planner chat", exact: true })
      .getByRole("link", { name: "Full conversation", exact: true });
    const reopenedHref = await reopenedFullConversation.getAttribute("href");
    if (!reopenedHref) throw new Error("The saved conversation link is missing.");
    expect(new URL(reopenedHref, page.url()).pathname).toBe(chatPath);
    expect(
      await page.evaluate(
        () => JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]").length,
      ),
    ).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("the studio alias still opens the primary globe and its editable sample journey", async ({
  page,
}) => {
  await page.goto("/studio");
  await expect(
    page.getByRole("region", { name: "Explore destinations", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Explore my Lisbon Sample journey", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Your floating day journey", exact: true }),
  ).toBeVisible();
  expect((await storedTrip(page)).brief.destinationId).toBe("lisbon");
});
