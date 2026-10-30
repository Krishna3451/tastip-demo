import { expect, test } from "@playwright/test";
import { resetE2ERegistrationQuota } from "../support/disposable-e2e-store";
import { E2E_ORIGIN } from "./environment";

// Retries share a server: isolate only the synthetic registration quota, never production limits.
test.beforeEach(() => resetE2ERegistrationQuota(E2E_ORIGIN));

for (const width of [375, 1440]) {
  test(`account chat backups preserve divergent device histories and reject stale writes at ${width}px`, async ({
    page,
    context,
    browser,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const username = `backup-${crypto.randomUUID().slice(0, 12)}`;
    const password = "backup-browser-test-729";
    const accountResponse = await context.request.post("/api/account", {
      headers: { origin: E2E_ORIGIN },
      data: { action: "register", username, password },
    });
    expect(accountResponse.ok()).toBe(true);
    const { account } = await accountResponse.json();
    const key = `tastip.reference.chats:${account.id}`;
    const local = {
      id: "backup-chat",
      title: "My private chat",
      updatedAt: 100,
      pendingMessage: "Never send on restore",
      messages: [{ id: "original-message", role: "user", text: "Original device history" }],
    };
    await page.addInitScript(
      ({ key, local }) => {
        if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify([local]));
      },
      { key, local },
    );
    await page.goto("/settings");
    const backup = page.getByRole("region", { name: "Chat backup", exact: true });
    await expect(backup).toContainText("No account backup.");
    await backup.getByRole("button", { name: "Save chat backup", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Save this chat backup?" })
      .getByRole("button", { name: "Save reviewed backup", exact: true })
      .click();
    await expect(backup.getByRole("status")).toContainText("Chat backup saved");
    const headers = { origin: E2E_ORIGIN, "X-Tastip-Account": account.id };
    const read = await context.request.get("/api/conversations", { headers });
    const saved = await read.json();
    expect(saved.revision).toBe(1);
    expect(saved.conversations[0].pendingMessage).toBeUndefined();
    const remote = {
      ...local,
      pendingMessage: "Also never resume",
      updatedAt: 200,
      messages: [{ id: "remote-message", role: "user", text: "Different second-device history" }],
    };
    const changed = await context.request.post("/api/conversations", {
      headers,
      data: { action: "save", conversations: [remote], expectedRevision: 1 },
    });
    expect(changed.ok()).toBe(true);
    await backup.getByRole("button", { name: "Save chat backup", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Save this chat backup?" })
      .getByRole("button", { name: "Save reviewed backup", exact: true })
      .click();
    await expect(backup.getByRole("alert")).toContainText("changed on another device");
    await backup.getByRole("button", { name: "Refresh backup", exact: true }).click();
    await expect(backup).toContainText("revision 2");
    await backup.getByRole("button", { name: "Restore chats", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Restore these chats?" })
      .getByRole("button", { name: "Restore and keep device chats", exact: true })
      .click();
    await expect(backup.getByRole("status")).toContainText("Backup restored");
    const merged = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), key);
    expect(merged).toHaveLength(2);
    expect(merged[0]).toEqual(local);
    expect(merged[1].messages).toEqual(remote.messages);
    expect(merged[1].pendingMessage).toBeUndefined();
    await page.reload();
    await expect(backup).toContainText("2 chats on this device");
    await backup.getByRole("button", { name: "Restore chats", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Restore these chats?" })
      .getByRole("button", { name: "Restore and keep device chats", exact: true })
      .click();
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, key),
    ).toBe(2);

    const other = await browser.newContext({ baseURL: E2E_ORIGIN });
    try {
      const anonymous = await other.request.get("/api/conversations", {
        headers: { "X-Tastip-Account": account.id },
      });
      expect(anonymous.status()).toBe(401);
      const signedIn = await other.request.post("/api/account", {
        headers: { origin: E2E_ORIGIN },
        data: { action: "login", username, password },
      });
      expect(signedIn.ok()).toBe(true);
      const newPage = await other.newPage();
      await newPage.goto("/settings");
      const newBackup = newPage.getByRole("region", { name: "Chat backup", exact: true });
      await expect(newBackup).toContainText("0 chats on this device");
      await newBackup.getByRole("button", { name: "Restore chats", exact: true }).click();
      await newPage
        .getByRole("dialog", { name: "Restore these chats?" })
        .getByRole("button", { name: "Restore and keep device chats", exact: true })
        .click();
      await expect(newBackup.getByRole("status")).toContainText("Backup restored");
      expect(
        await newPage.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]"), key),
      ).toEqual(
        saved.conversations.map((chat: object) => ({
          ...chat,
          updatedAt: 200,
          messages: remote.messages,
        })),
      );
    } finally {
      await other.close();
    }
    await backup.getByRole("button", { name: "Restore chats", exact: true }).click();
    // Another tab writes after this page reviewed its local history.
    await page.evaluate((key) => {
      const chats = JSON.parse(localStorage.getItem(key) ?? "[]");
      chats.push({ id: "new-tab-chat", title: "Newer device draft", updatedAt: 300, messages: [] });
      localStorage.setItem(key, JSON.stringify(chats));
    }, key);
    await page
      .getByRole("dialog", { name: "Restore these chats?" })
      .getByRole("button", { name: "Restore and keep device chats", exact: true })
      .click();
    await expect(backup.getByRole("alert")).toContainText("restore was not saved");
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, key),
    ).toBe(3);
    await page.reload();
    await expect(backup).toContainText("3 chats on this device");
    await backup.getByRole("button", { name: "Delete account backup", exact: true }).click();
    await page
      .getByRole("dialog", { name: "Delete the account backup?" })
      .getByRole("button", { name: "Delete reviewed backup", exact: true })
      .click();
    await expect(backup.getByRole("status")).toContainText("Account chat backup deleted");
    expect(
      await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "[]").length, key),
    ).toBe(3);
    expect(
      (await (await context.request.get("/api/conversations", { headers })).json()).conversations,
    ).toBeNull();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  });
}
