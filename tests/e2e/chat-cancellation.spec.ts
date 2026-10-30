import { expect, test } from "@playwright/test";

for (const width of [375, 1440]) {
  test(`stopping and retrying a reply preserves the draft, ignores late output and keeps one request message at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const releases: (() => void)[] = [];
    const finished: Promise<void>[] = [];
    const bodies: { message: string; history: { role: string; content: string }[] }[] = [];
    await page.route("**/api/chat", async (route) => {
      const index = bodies.length;
      bodies.push(route.request().postDataJSON());
      let finish = () => {};
      finished.push(
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
      );
      await new Promise<void>((resolve) => {
        releases.push(resolve);
      });
      try {
        await route.fulfill({
          json: {
            message: index === 0 ? "Late discarded reply" : "Accepted retry reply",
            provider: "openai",
          },
        });
      } catch {
        /* An aborted browser request may no longer accept a response. */
      }
      finish();
    });
    await page.goto("/chat/new");
    const composer = page.getByRole("textbox", {
      name: "Message your travel companion",
      exact: true,
    });
    await composer.fill("Help me choose a relaxed holiday rhythm");
    await page.getByRole("button", { name: "Send message", exact: true }).click();
    await expect.poll(() => releases.length).toBe(1);
    await composer.fill("Keep this next question in the composer");
    await page.getByRole("button", { name: "Stop reply", exact: true }).click();
    await expect(page.getByRole("status").filter({ hasText: "Stopped waiting" })).toBeVisible();
    await expect(composer).toHaveValue("Keep this next question in the composer");
    await page.getByRole("button", { name: "Retry reply", exact: true }).click();
    await expect.poll(() => releases.length).toBe(2);
    releases[0]?.();
    await finished[0];
    await expect(page.getByRole("button", { name: "Stop reply", exact: true })).toBeVisible();
    await expect(
      page.locator(".chat-message.assistant-message").filter({ hasText: "Late discarded reply" }),
    ).toHaveCount(0);
    releases[1]?.();
    await expect(
      page.locator(".chat-message.assistant-message").filter({ hasText: "Accepted retry reply" }),
    ).toBeVisible();
    await expect(page.locator(".chat-message.user-message")).toHaveCount(1);
    await expect(composer).toHaveValue("Keep this next question in the composer");
    expect(bodies[1]?.message).toBe(bodies[0]?.message);
    expect(bodies[1]?.history).toEqual([]);
    await page.reload();
    await expect(
      page.locator(".chat-message.assistant-message").filter({ hasText: "Accepted retry reply" }),
    ).toBeVisible();
    await expect(page.locator(".chat-message.user-message")).toHaveCount(1);
    await expect(
      page.locator(".chat-message.assistant-message").filter({ hasText: "Late discarded reply" }),
    ).toHaveCount(0);
  });
}

test("a failed reply can retry the same message without duplicating it or consuming a new composer draft", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/chat", (route) => {
    attempts++;
    return route.fulfill(
      attempts === 1
        ? { status: 503, json: { error: { message: "Synthetic provider failure" } } }
        : { json: { message: "Recovered reply", provider: "openai" } },
    );
  });
  await page.goto("/chat/new");
  const composer = page.getByRole("textbox", {
    name: "Message your travel companion",
    exact: true,
  });
  await composer.fill("Which details should I decide first?");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Travel conversation" }).getByRole("alert"),
  ).toContainText("Synthetic provider failure");
  await composer.fill("A separate unsent question");
  await page.getByRole("button", { name: "Retry reply", exact: true }).click();
  await expect(
    page.locator(".chat-message.assistant-message").filter({ hasText: "Recovered reply" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Travel conversation" }).getByRole("alert"),
  ).toHaveCount(0);
  await expect(composer).toHaveValue("A separate unsent question");
  await expect(page.locator(".chat-message.user-message")).toHaveCount(1);
  expect(attempts).toBe(2);
});
