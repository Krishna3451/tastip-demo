import { expect, test } from "@playwright/test";

function frame(value: unknown) {
  return `${JSON.stringify(value)}\n`;
}
test("a complete incremental reply persists once and reopens without sending again", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true } } }),
  );
  await page.route("**/api/chat", async (route) => {
    calls++;
    expect(route.request().postDataJSON().stream).toBe(true);
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        frame({ type: "text", text: "A calm morning" }) +
        frame({ type: "text", text: "A calm morning in Lisbon." }) +
        frame({
          type: "complete",
          reply: { message: "A calm morning in Lisbon.", provider: "openai" },
        }),
    });
  });
  await page.goto("/discover");
  await page.getByLabel("Ask Tastip", { exact: true }).fill("Help me think about Lisbon");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
  await expect(
    conversation.locator(".chat-message").filter({ hasText: "A calm morning in Lisbon." }),
  ).toBeVisible();
  await expect(
    conversation.getByRole("region", { name: "Reply in progress", exact: true }),
  ).toHaveCount(0);
  const before = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]"),
  );
  expect(
    before[0].messages.filter((message: { role: string }) => message.role === "assistant"),
  ).toHaveLength(1);
  await page.reload();
  await expect(
    conversation.locator(".chat-message").filter({ hasText: "A calm morning in Lisbon." }),
  ).toBeVisible();
  expect(calls).toBe(1);
});

test("a dropped partial reply never becomes accepted history and retries one user message", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { openai: true } } }),
  );
  await page.route("**/api/chat", async (route) => {
    calls++;
    await route.fulfill({
      contentType: "application/x-ndjson",
      body:
        calls === 1
          ? frame({ type: "text", text: "This partial must not persist" })
          : frame({
              type: "complete",
              reply: { message: "The completed retry.", provider: "openai" },
            }),
    });
  });
  await page.goto("/discover");
  await page.getByLabel("Ask Tastip", { exact: true }).fill("Suggest a relaxed travel pace");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  const conversation = page.getByRole("region", { name: "Travel conversation", exact: true });
  await expect(conversation.getByRole("alert")).toContainText("interrupted");
  await expect(
    conversation.locator(".chat-message").filter({ hasText: "This partial must not persist" }),
  ).toHaveCount(0);
  let chats = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]"),
  );
  expect(chats[0].messages).toHaveLength(1);
  await conversation
    .getByLabel("Message your travel companion", { exact: true })
    .fill("Keep this next question");
  await conversation.getByRole("button", { name: "Retry reply", exact: true }).click();
  await expect(
    conversation.locator(".chat-message").filter({ hasText: "The completed retry." }),
  ).toBeVisible();
  await expect(
    conversation.getByLabel("Message your travel companion", { exact: true }),
  ).toHaveValue("Keep this next question");
  chats = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.reference.chats:guest") ?? "[]"),
  );
  expect(
    chats[0].messages.filter((message: { role: string }) => message.role === "user"),
  ).toHaveLength(1);
  expect(
    chats[0].messages.filter((message: { role: string }) => message.role === "assistant"),
  ).toHaveLength(1);
});
