import { expect, type Page, test } from "@playwright/test";
import type { Conversation } from "../../apps/web/src/features/planner/lib/conversations";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src";

const chatsKey = "tastip.reference.chats:guest";
const settingsKey = "tastip.reference.settings:guest";
const account = { id: "00000000-0000-4000-8000-000000000281", username: "hosted_fixture" };
const pendingMessage = "Synthetic held request must wait for an explicit Send.";
function history(tripId?: string): Conversation {
  return {
    id: "hosted-signin-fixture",
    title: "Synthetic hosted history",
    renamed: true,
    updatedAt: 1,
    ...(tripId ? { tripId } : {}),
    pendingMessage,
    messages: [
      { id: "guest-user", role: "user", text: "Synthetic earlier request." },
      { id: "guest-answer", role: "assistant", text: "Synthetic completed reply stays readable." },
    ],
  };
}
async function setup(
  page: Page,
  options: { inline?: boolean; unreadable?: boolean; delayHealth?: boolean } = {},
) {
  let signedIn = false;
  const paidCalls: string[] = [];
  const checkedOwners: (string | null)[] = [];
  let releaseHealth = () => {};
  const healthGate = new Promise<void>((resolve) => {
    releaseHealth = resolve;
  });
  await page.route("**/api/account", async (route) => {
    if (route.request().method() === "POST") {
      expect(route.request().postDataJSON().action).toBe("login");
      signedIn = true;
    }
    await route.fulfill({ json: { account: signedIn ? account : null } });
  });
  await page.route("**/api/health", async (route) => {
    if (options.delayHealth) await healthGate;
    checkedOwners.push(route.request().headers()["x-tastip-account"] ?? null);
    await route.fulfill({
      json: {
        requiresSignIn: !signedIn,
        providers: { openai: signedIn, qloo: signedIn },
      },
    });
  });
  for (const endpoint of ["chat", "voice/session", "taste", "taste/search"]) {
    await page.route(`**/api/${endpoint}`, async (route) => {
      paidCalls.push(route.request().url());
      await route.fulfill({
        status: 503,
        json: { error: { message: "Unexpected synthetic provider call." } },
      });
    });
  }
  const trip = options.inline ? createDemoTrip(DEFAULT_BRIEF) : undefined;
  const chat = history(trip?.id);
  await page.addInitScript(
    ({ trip, chat, unreadable, chatsKey, settingsKey, account }) => {
      if (!localStorage.getItem(chatsKey)) localStorage.setItem(chatsKey, JSON.stringify([chat]));
      // Restoring a chat can legitimately leave the same ID in two private caches.
      localStorage.setItem(`tastip.reference.chats:${account.id}`, JSON.stringify([chat]));
      if (trip && !localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
      if (unreadable) localStorage.setItem(settingsKey, "{synthetic unreadable hosted preferences");
    },
    { trip, chat, unreadable: options.unreadable, chatsKey, settingsKey, account },
  );
  return { chat, trip, paidCalls, releaseHealth, checkedOwners };
}
async function openInline(page: Page) {
  await page
    .getByRole("navigation", { name: "Main navigation", exact: true })
    .getByRole("button", { name: "Chat", exact: true })
    .click();
  return page
    .getByRole("region", { name: "Planner chat", exact: true })
    .getByRole("region", { name: "Travel conversation", exact: true });
}
async function noOverflow(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1),
  ).toBe(true);
}

for (const width of [375, 1440]) {
  test(`hosted guest entry explains sign-in and keeps the sample accessible at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const { paidCalls } = await setup(page);
    await page.goto("/");
    const cta = page.getByRole("button", { name: "Sign in to find your places", exact: true });
    await expect(cta).toBeEnabled();
    await page.getByText("Describe a route", { exact: true }).click();
    await page
      .getByRole("textbox", { name: "Describe your trip", exact: true })
      .fill("Synthetic unsent trip idea.");
    await cta.click();
    const dialog = page.getByRole("dialog", { name: "Tastip account", exact: true });
    await expect(
      dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close account", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Describe your trip", exact: true }),
    ).toHaveValue("Synthetic unsent trip idea.");
    await noOverflow(page);
    await page.screenshot({
      path: test.info().outputPath(`hosted-entry-${width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Explore my Lisbon" }).click();
    await expect(page.getByRole("region", { name: "Your trip plan", exact: true })).toBeVisible();
    expect(paidCalls).toEqual([]);
  });

  for (const inline of [true, false]) {
    test(`hosted ${inline ? "inline" : "full"} conversation retains history and draft without auto-resuming on sign-in at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const { chat, paidCalls, releaseHealth, checkedOwners } = await setup(page, {
        inline,
        delayHealth: true,
      });
      await page.goto(inline ? "/" : `/chat/${chat.id}`);
      const conversation = inline
        ? await openInline(page)
        : page.getByRole("region", { name: "Travel conversation", exact: true });
      await expect(conversation.locator(".chat-message.assistant-message")).toContainText(
        "Synthetic completed reply stays readable.",
      );
      const composer = conversation.getByRole("textbox", {
        name: "Message your travel companion",
        exact: true,
      });
      await composer.fill("Synthetic unsent guest composer draft.");
      await expect(
        conversation.getByRole("button", { name: "Send message", exact: true }),
      ).toBeDisabled();
      expect(paidCalls).toEqual([]);
      releaseHealth();
      await expect(conversation.getByRole("alert")).toContainText("Sign in to chat");
      await expect(
        conversation.getByRole("button", { name: "Talk to Tastip", exact: true }),
      ).toBeDisabled();
      await composer.press("Enter");
      await conversation.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "Tastip account", exact: true });
      await expect(dialog).toBeVisible();
      await dialog.getByRole("button", { name: "Close account", exact: true }).click();
      await expect(composer).toHaveValue("Synthetic unsent guest composer draft.");
      await expect(conversation.locator(".chat-message.assistant-message")).toContainText(
        "Synthetic completed reply stays readable.",
      );
      expect(
        await page.evaluate(
          (key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].pendingMessage,
          chatsKey,
        ),
      ).toBe(pendingMessage);
      await noOverflow(page);
      await page.screenshot({
        path: test.info().outputPath(`hosted-${inline ? "inline" : "full"}-${width}.png`),
        fullPage: true,
      });
      await conversation.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
      await dialog.getByLabel("Account username", { exact: true }).fill(account.username);
      await dialog
        .getByLabel("Account password", { exact: true })
        .fill("Synthetic-fixture-password-281");
      await dialog.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
      await expect(dialog).toBeHidden();
      await expect.poll(() => checkedOwners.at(-1)).toBe(account.id);
      if (!inline) {
        await expect(conversation.locator(".chat-message.assistant-message")).toContainText(
          "Synthetic completed reply stays readable.",
        );
        const signedInComposer = conversation.getByRole("textbox", {
          name: "Message your travel companion",
          exact: true,
        });
        await signedInComposer.fill("Synthetic signed-in request still waits for Send.");
        await expect(
          conversation.getByRole("button", { name: "Send message", exact: true }),
        ).toBeEnabled();
        expect(
          await page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].pendingMessage,
            `tastip.reference.chats:${account.id}`,
          ),
        ).toBe(pendingMessage);
      }
      // Authentication changes workspaces; it must not send or consume the guest's held entry.
      await expect
        .poll(() =>
          page.evaluate(
            (key) => JSON.parse(localStorage.getItem(key) ?? "[]")[0].pendingMessage,
            chatsKey,
          ),
        )
        .toBe(pendingMessage);
      expect(paidCalls).toEqual([]);
    });
  }
}

test("hosted sign-in does not replace unreadable-preference recovery", async ({ page }) => {
  const { chat, paidCalls } = await setup(page, { unreadable: true });
  await page.goto(`/chat/${chat.id}`);
  const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
  await expect(conversation.getByRole("alert")).toContainText(
    "saved preferences could not be read",
  );
  await expect(
    conversation.getByRole("link", { name: "Review preferences in Settings", exact: true }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("button", { name: "Sign in to Tastip", exact: true }),
  ).toHaveCount(0);
  await expect(
    conversation.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  expect(paidCalls).toEqual([]);
});

test("hosted discovery and voice modal lead to the existing account dialog", async ({ page }) => {
  const { paidCalls } = await setup(page);
  await page.goto("/discover");
  const banner = page.getByRole("complementary", { name: "Personal recommendations", exact: true });
  await banner.getByRole("button", { name: "Sign in to find your places", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Tastip account", exact: true })
    .getByRole("button", { name: "Close account", exact: true })
    .click();
  await page.getByRole("button", { name: "Start voice", exact: true }).click();
  const voice = page.getByRole("dialog", { name: "Talk to Tastip", exact: true });
  await expect(voice.getByRole("button", { name: "Talk to Tastip", exact: true })).toBeDisabled();
  await voice.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Tastip account", exact: true })).toBeVisible();
  expect(paidCalls).toEqual([]);
});
