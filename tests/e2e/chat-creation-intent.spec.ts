import { expect, type Page, test } from "@playwright/test";
import { buildTripPreview } from "../../apps/web/src/features/planner/lib/trip-generation";
import { DEFAULT_BRIEF, type TripRoute } from "../../packages/domain/src";

const summary =
  "Summarize our Lisbon–Porto route in two sentences, and name one practical detail we should verify. Don’t change the plan.";
const informationalPrompts = [
  summary,
  "What should I pack for my next trip?",
  "What are the dates of my next trip?",
];
const nextTrip =
  "Don't change our current trip; plan a new trip to Kyoto for 5 days with 2 adults.";
const reply =
  "Synthetic summary: Lisbon comes before Porto. Verify the train schedule before departure. You may build a new trip later.";
const chatId = "intent-fixture-chat";
const route: TripRoute = {
  startDate: null,
  stays: [
    { id: "lisbon-stay", destinationId: "lisbon", days: 2 },
    { id: "porto-stay", destinationId: "porto", days: 2 },
  ],
  transfers: [
    {
      id: "lisbon-porto-transfer",
      fromStayId: "lisbon-stay",
      toStayId: "porto-stay",
      mode: "undecided",
    },
  ],
};

async function storedTrip(page: Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"));
}

for (const width of [375, 1440])
  for (const surface of ["inline", "full"] as const)
    test(`bound ${surface} chat summarizes without a creation card, then reviews an explicit next trip at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.emulateMedia({ reducedMotion: "reduce" });
      const trip = buildTripPreview({ ...DEFAULT_BRIEF, days: 4 }, route, []);
      await page.addInitScript(
        ({ trip, chatId }) => {
          if (!localStorage.getItem("tastip.trip.v1"))
            localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
          if (!localStorage.getItem("tastip.reference.chats:guest"))
            localStorage.setItem(
              "tastip.reference.chats:guest",
              JSON.stringify([
                {
                  id: chatId,
                  title: "Synthetic Lisbon–Porto conversation",
                  tripId: trip.id,
                  updatedAt: 1,
                  messages: [
                    {
                      id: "initial-request",
                      role: "user",
                      text: "Plan a trip to Lisbon and Porto for 4 days",
                    },
                    {
                      id: "initial-reply",
                      role: "assistant",
                      text: "Synthetic earlier planning reply.",
                    },
                  ],
                },
              ]),
            );
        },
        { trip, chatId },
      );
      await page.route("**/api/health", (request) =>
        request.fulfill({ json: { providers: { openai: true, qloo: true } } }),
      );
      const seen: string[] = [];
      await page.route("**/api/chat", (request) => {
        const body = request.request().postDataJSON();
        expect(body.trip).toMatchObject({ id: trip.id, version: trip.version });
        seen.push(body.message);
        return request.fulfill({ json: { provider: "openai", message: reply } });
      });
      let tasteCalls = 0;
      await page.route("**/api/taste**", (request) => {
        tasteCalls++;
        return request.abort();
      });

      async function open() {
        if (surface === "inline") {
          await page.goto("/");
          await page
            .getByRole("navigation", { name: "Main navigation", exact: true })
            .getByRole("button", { name: "Chat", exact: true })
            .click();
        } else await page.goto(`/chat/${chatId}`);
        return page.getByRole("region", { name: "Travel conversation", exact: true });
      }
      let conversation = await open();
      for (const [index, prompt] of informationalPrompts.entries()) {
        await conversation
          .getByRole("textbox", { name: "Message your travel companion" })
          .fill(prompt);
        await conversation.getByRole("button", { name: "Send message", exact: true }).click();
        await expect(
          conversation.locator(".assistant-message").filter({ hasText: reply }),
        ).toHaveCount(index + 1);
        await expect(
          conversation.getByRole("region", { name: "Plan from this conversation", exact: true }),
        ).toHaveCount(0);
        await expect(
          conversation.getByRole("button", { name: "Build this trip", exact: true }),
        ).toHaveCount(0);
        expect(await storedTrip(page)).toEqual(trip);
      }
      expect(seen).toEqual(informationalPrompts);

      conversation = await open();
      await expect(
        conversation.locator(".assistant-message").filter({ hasText: reply }).last(),
      ).toBeVisible();
      await expect(
        conversation.getByRole("button", { name: "Build this trip", exact: true }),
      ).toHaveCount(0);
      await conversation
        .getByRole("textbox", { name: "Message your travel companion" })
        .fill(nextTrip);
      await conversation.getByRole("button", { name: "Send message", exact: true }).click();
      const build = conversation.getByRole("button", { name: "Build this trip", exact: true });
      await expect(build).toBeEnabled();
      await build.click();
      const details = page.getByRole("dialog", { name: "Create a trip", exact: true });
      await expect(
        details.getByLabel("What should I keep in mind for this trip?", { exact: true }),
      ).toHaveValue(nextTrip);
      expect(await storedTrip(page)).toEqual(trip);
      expect(seen).toEqual([...informationalPrompts, nextTrip]);
      expect(tasteCalls).toBe(0);
    });
