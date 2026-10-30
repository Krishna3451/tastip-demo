import { expect, type Page, test } from "@playwright/test";
import type { Conversation } from "../../apps/web/src/features/planner/lib/conversations";
import { createDemoTrip, DEFAULT_BRIEF, type Trip } from "../../packages/domain/src";

function history(trip: Trip): Conversation {
  return {
    id: "warm-conversation-fixture",
    title: "Synthetic Lisbon conversation",
    renamed: true,
    tripId: trip.id,
    updatedAt: 1,
    messages: [
      { id: "earlier-user", role: "user", text: "Synthetic fixture: a relaxed Lisbon trip." },
      { id: "earlier-reply", role: "assistant", text: "Synthetic earlier completed reply." },
    ],
  };
}
async function guest(page: Page) {
  await page.route("**/api/account", (route) => route.fulfill({ json: { account: null } }));
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true, qloo: false } } }),
  );
}
async function storedTrip(page: Page): Promise<Trip> {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}
async function capture(page: Page, name: string) {
  if (!process.env.TASTIP_CAPTURE_CONVERSATION) return;
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path });
  await test.info().attach(name, { path, contentType: "image/png" });
}
async function readableFrame(page: Page) {
  const main = page.locator("main.tastip-conversation");
  await expect(main).toBeVisible();
  expect(await main.evaluate((element) => getComputedStyle(element).colorScheme)).toBe("dark");
  await expect(page.locator(".mt-sidebar")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
  const composer = conversation.locator(".chat-composer");
  const bounds = await composer.boundingBox();
  if (!bounds) throw new Error("The full conversation composer must stay in view.");
  expect(bounds.y).toBeGreaterThanOrEqual(0);
  expect(bounds.y + bounds.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  const messages = await conversation.locator(".conversation").boundingBox();
  if (!messages) throw new Error("The conversation must retain its own reading area.");
  expect(messages.y + messages.height).toBeLessThanOrEqual(bounds.y + 1);
  const colors = await conversation.evaluate((element) => ({
    text: getComputedStyle(element.closest("main")!).color,
    reply: getComputedStyle(element.querySelector(".assistant-message")!).color,
  }));
  expect(colors.reply).toBe(colors.text);
}

for (const width of [375, 1440]) {
  test(`warm full chat reviews one canonical edit and returns to its selected day at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await guest(page);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const trip = createDemoTrip({ ...DEFAULT_BRIEF, days: 3 });
    const stop = trip.stops.find((item) => item.dayId === "day-2")!;
    const chat = history(trip);
    await page.addInitScript(
      ({ trip, chat }) => {
        if (!localStorage.getItem("tastip.trip.v1"))
          localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
        if (!localStorage.getItem("tastip.reference.chats:guest"))
          localStorage.setItem("tastip.reference.chats:guest", JSON.stringify([chat]));
      },
      { trip, chat },
    );
    let calls = 0;
    let voiceCalls = 0;
    await page.route("**/api/voice/session", (route) => {
      voiceCalls++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "Voice requires an explicit action." } },
      });
    });
    await page.route("**/api/chat", async (route) => {
      calls++;
      expect(route.request().postDataJSON().trip).toMatchObject({
        id: trip.id,
        version: trip.version,
      });
      const reply = {
        provider: "openai",
        message: "Synthetic completed reply: review keeping the day-two visit.",
        proposal: {
          id: `warm-pin-${width}`,
          tripId: trip.id,
          baseVersion: trip.version,
          summary: "Keep the selected day-two visit.",
          operations: [{ type: "pin-stop", stopId: stop.id, pinned: true }],
        },
      };
      await route.fulfill({
        contentType: "application/x-ndjson",
        body: [
          { type: "text", text: reply.message },
          { type: "complete", reply },
        ]
          .map((frame) => `${JSON.stringify(frame)}\n`)
          .join(""),
      });
    });
    await page.goto(`/chat/${chat.id}?return=planner&day=day-2`);
    await expect(page.getByRole("heading", { name: chat.title, exact: true })).toBeVisible();
    const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await expect(nav.getByRole("button", { name: "Chat", exact: true })).toHaveAttribute(
      "aria-current",
      "page",
    );
    const context = page.locator(".mt-workspace-header");
    await expect(context).toContainText("Lisbon");
    await expect(context).toContainText("Draft v1");
    await expect(page.getByRole("link", { name: "Back to planner", exact: true })).toHaveAttribute(
      "href",
      "/?day=day-2",
    );
    const returnToDay = page.getByRole("link", { name: "Trip", exact: true });
    await expect(returnToDay).toHaveAttribute("href", "/?day=day-2");
    await readableFrame(page);
    const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
    const composer = conversation.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await composer.fill("Keep this selected day-two visit.");
    await conversation.getByRole("button", { name: "Send message", exact: true }).click();
    await expect(conversation.getByText("Review trip change", { exact: true })).toBeVisible();
    expect(await storedTrip(page)).toEqual(trip);
    await capture(page, `warm-chat-review-${width}`);
    await conversation.getByRole("button", { name: "Apply change", exact: true }).click();
    await expect.poll(async () => (await storedTrip(page)).version).toBe(trip.version + 1);
    const edited = await storedTrip(page);
    expect(edited.stops.find((item) => item.id === stop.id)?.pinned).toBe(true);
    expect(edited.places).toEqual(trip.places);
    await expect(context).toContainText("Draft v2");
    await composer.fill("Keep this separate unsent follow-up.");
    await nav.getByRole("button", { name: "Chat", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
    await expect(
      drawer.getByRole("link", { name: /Synthetic Lisbon conversation/ }),
    ).toHaveAttribute("href", `/chat/${chat.id}?return=planner&day=day-2`);
    await drawer.press("Escape");
    await expect(composer).toHaveValue("Keep this separate unsent follow-up.");
    expect(calls).toBe(1);
    expect(voiceCalls).toBe(0);
    await page.reload();
    await expect(conversation.getByText("Applied · draft v2", { exact: true })).toBeVisible();
    await readableFrame(page);
    await capture(page, `warm-chat-complete-${width}`);
    expect(calls).toBe(1);
    expect(await storedTrip(page)).toEqual(edited);
    await returnToDay.click();
    await expect(page).toHaveURL(/\/\?day=day-2$/);
    await expect(page.getByRole("list", { name: "Day 2 timeline", exact: true })).toBeVisible();
    expect(await storedTrip(page)).toEqual(edited);
    expect(errors).toEqual([]);
  });

  test(`chat alias validates its day and history does not borrow another trip context at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: width === 375 ? 812 : 950 });
    await guest(page);
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const other = {
      id: "unassociated-chat",
      title: "Synthetic standalone question",
      updatedAt: 1,
      messages: [{ id: "unrelated-message", role: "user", text: "Synthetic standalone history." }],
    };
    await page.addInitScript(
      ({ trip, other }) => {
        if (!localStorage.getItem("tastip.trip.v1"))
          localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
        if (!localStorage.getItem("tastip.reference.chats:guest"))
          localStorage.setItem("tastip.reference.chats:guest", JSON.stringify([other]));
      },
      { trip, other },
    );
    let calls = 0;
    await page.route("**/api/chat", (route) => {
      calls++;
      return route.fulfill({
        status: 503,
        json: { error: { message: "Opening a chat must not send a request." } },
      });
    });
    await page.goto(`/chat?trip=${trip.id}&return=planner&day=not-a-real-day`);
    await expect(page).toHaveURL(/\/chat\/[A-Za-z0-9-]+\?return=planner/);
    await expect(page.getByRole("link", { name: "Trip", exact: true })).toHaveAttribute(
      "href",
      "/?day=day-1",
    );
    await expect(page.getByRole("link", { name: "Back to planner", exact: true })).toHaveAttribute(
      "href",
      "/?day=day-1",
    );
    const createdPath = new URL(page.url()).pathname;
    await page.reload();
    expect(new URL(page.url()).pathname).toBe(createdPath);
    const chats = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]"),
    );
    expect(chats).toHaveLength(2);
    const nav = page.getByRole("navigation", { name: "Main navigation", exact: true });
    await nav.getByRole("button", { name: "Chat", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Chats", exact: true });
    const standalone = drawer.getByRole("link", { name: /Synthetic standalone question/ });
    await expect(standalone).toHaveAttribute("href", `/chat/${other.id}`);
    await standalone.click();
    await expect(page.getByRole("heading", { name: other.title, exact: true })).toBeVisible();
    await expect(page.locator(".mt-workspace-header")).toContainText(
      "Your personal travel assistant",
    );
    await expect(page.getByRole("link", { name: "Trip", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Share", exact: true })).toBeDisabled();
    expect(calls).toBe(0);
    expect(await storedTrip(page)).toEqual(trip);
    await readableFrame(page);
  });
}

test("warm full-chat sign-out hides owner history and preserves its private stored copy", async ({
  page,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  const owner = { id: "00000000-0000-4000-8000-000000000086", username: "warm-chat-owner" };
  const chat = { ...history(trip), title: "Synthetic private owner conversation" };
  let account: typeof owner | null = owner;
  await page.route("**/api/account", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON().action).toBe("logout");
      account = null;
    }
    await route.fulfill({ json: { account } });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: false, qloo: false } } }),
  );
  await page.route("**/api/saved", (route) =>
    route.fulfill({ json: { workspace: { places: [], collections: [] }, revision: 0 } }),
  );
  await page.addInitScript(
    ({ trip, chat, owner }) => {
      if (!localStorage.getItem(`tastip.trip.v1:${owner.id}`))
        localStorage.setItem(`tastip.trip.v1:${owner.id}`, JSON.stringify(trip));
      if (!localStorage.getItem(`tastip.reference.chats:${owner.id}`))
        localStorage.setItem(`tastip.reference.chats:${owner.id}`, JSON.stringify([chat]));
    },
    { trip, chat, owner },
  );
  await page.goto(`/chat/${chat.id}?return=planner&day=day-2`);
  await expect(page.getByRole("heading", { name: chat.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: `${owner.username} Menu`, exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("button", { name: "Sign in to Tastip", exact: true })).toBeVisible();
  await page.goto(`/chat/${chat.id}`);
  await expect(page.getByRole("heading", { name: "Chat not found", exact: true })).toBeVisible();
  await expect(page.getByText(chat.title, { exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`tastip.reference.chats:${id}`) ?? "[]"),
      owner.id,
    ),
  ).toEqual([chat]);
  expect(
    await page.evaluate(
      (id) => JSON.parse(localStorage.getItem(`tastip.trip.v1:${id}`) ?? "null"),
      owner.id,
    ),
  ).toEqual(trip);
});
