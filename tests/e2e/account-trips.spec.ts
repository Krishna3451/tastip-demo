import { expect, type Page, test } from "@playwright/test";
import { E2E_ORIGIN } from "./environment";

const password = "Synthetic-test-passphrase-729";

async function registerAccount(page: Page, username: string) {
  await page.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tastip account" });
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Account username", { exact: true }).fill(username);
  await dialog.getByLabel("Account password", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Create my account", exact: true }).click();
  await expect(dialog).not.toBeVisible();
}

test("account trips survive a fresh browser, isolate users and revoke read-only snapshots", async ({
  page,
  browser,
}) => {
  test.setTimeout(90_000);
  const username = `traveler_${crypto.randomUUID().slice(0, 12)}`;
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await page.getByRole("button", { name: "Trip details", exact: true }).click();
  const tripDetails = page.getByRole("region", {
    name: "Travelers, pace and activity budget",
    exact: true,
  });
  await tripDetails.getByLabel("Trip travelers", { exact: true }).fill("3");
  await tripDetails.getByLabel("Trip pace", { exact: true }).selectOption("slow");
  await tripDetails.getByLabel("Trip activity budget", { exact: true }).fill("100.01");
  await tripDetails.getByRole("button", { name: "Apply trip details", exact: true }).click();
  await expect(tripDetails.getByRole("status")).toContainText("Trip details updated");
  await page.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Tastip account" });
  await dialog.getByRole("button", { name: "Create account", exact: true }).click();
  await dialog.getByLabel("Account username", { exact: true }).fill(username);
  await dialog.getByLabel("Account password", { exact: true }).fill(password);
  await dialog.getByRole("button", { name: "Create my account", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lisbon");
  await page.getByRole("button", { name: "Saved trips", exact: true }).click();
  const collection = page.getByRole("region", { name: "Account saved trips", exact: true });
  await collection.getByRole("button", { name: "Save trip to account", exact: true }).click();
  await expect(collection.getByRole("status")).toContainText(
    "Saved this exact draft to your account",
  );
  await collection.getByRole("button", { name: "Create read-only link", exact: true }).click();
  const link = collection.getByLabel("Read-only trip link", { exact: true });
  await expect(link).toBeVisible();
  const shareUrl = await link.inputValue();
  const account = (await (await page.request.get("/api/account")).json()).account;
  const ownerHeaders = { "X-Tastip-Account": account.id };
  const list = await page.request.get("/api/trips", { headers: ownerHeaders });
  expect(list.status()).toBe(200);
  const id = (await list.json()).trips[0].id as string;
  const other = await browser.newContext();
  const viewer = await other.newPage();
  await viewer.goto(shareUrl);
  await expect(viewer.getByRole("heading", { level: 1 })).toContainText("Lisbon");
  await expect(viewer.getByText("Demo · Slow Morning Café", { exact: true })).toBeVisible();
  await expect(viewer.getByText("3 travelers", { exact: true })).toBeVisible();
  await expect(viewer.getByText("Unhurried", { exact: true })).toBeVisible();
  expect(await viewer.content()).not.toContain("100.01");
  expect((await other.request.get(`/api/trips?id=${id}`, { headers: ownerHeaders })).status()).toBe(
    401,
  );
  await viewer.goto("/studio");
  const login = await other.request.post("/api/account", {
    headers: { Origin: E2E_ORIGIN },
    data: { action: "login", username, password },
  });
  expect(login.status()).toBe(200);
  let releaseSession = () => {};
  const sessionGate = new Promise<void>((resolve) => {
    releaseSession = resolve;
  });
  await viewer.route("**/api/account", async (route) => {
    await sessionGate;
    await route.continue();
  });
  await viewer.reload();
  await expect(viewer.getByRole("button", { name: "Saved trips", exact: true })).toBeDisabled();
  releaseSession();
  await expect(viewer.getByRole("button", { name: "Saved trips", exact: true })).toBeEnabled();
  await viewer.unroute("**/api/account");
  await viewer.getByRole("button", { name: "Saved trips", exact: true }).click();
  await viewer.getByRole("button", { name: "Open account trip Lisbon", exact: true }).click();
  await expect(viewer.getByRole("heading", { level: 1 })).toContainText("Lisbon");
  await viewer.getByRole("button", { name: "Trip details", exact: true }).click();
  const restoredDetails = viewer.getByRole("region", {
    name: "Travelers, pace and activity budget",
    exact: true,
  });
  await expect(restoredDetails.getByLabel("Trip travelers", { exact: true })).toHaveValue("3");
  await expect(restoredDetails.getByLabel("Trip pace", { exact: true })).toHaveValue("slow");
  await expect(restoredDetails.getByLabel("Trip activity budget", { exact: true })).toHaveValue(
    "100.01",
  );
  expect(
    (
      await other.request.post("/api/account", {
        headers: { Origin: "https://unrelated.example" },
        data: { action: "logout" },
      })
    ).status(),
  ).toBe(403);
  await collection.getByRole("button", { name: "Turn off this link", exact: true }).click();
  await expect(collection.getByRole("status")).toContainText("turned off");
  expect((await other.request.get(shareUrl)).status()).toBe(404);
  const stranger = await browser.newContext();
  expect(
    (
      await stranger.request.post("/api/account", {
        headers: { Origin: E2E_ORIGIN },
        data: {
          action: "register",
          username: `other_${crypto.randomUUID().slice(0, 12)}`,
          password,
        },
      })
    ).status(),
  ).toBe(200);
  expect(
    (
      await stranger.request.get(`/api/trips?id=${id}`, {
        headers: {
          "X-Tastip-Account": (
            await (await stranger.request.get("/api/account")).json()
          ).account.id,
        },
      })
    ).status(),
  ).toBe(404);
  await other.close();
  await stranger.close();
});

test("other tabs clear the previous account workspace when sign-in changes", async ({
  page,
  context,
}) => {
  const alice = `tabs_a_${crypto.randomUUID().slice(0, 10)}`;
  const bob = `tabs_b_${crypto.randomUUID().slice(0, 10)}`;
  await page.goto("/studio");
  await page.getByRole("button", { name: "Explore my Lisbon" }).click();
  await registerAccount(page, alice);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Lisbon");
  const previousAccount = (await (await page.request.get("/api/account")).json()).account.id;
  const otherTab = await context.newPage();
  await otherTab.goto("/studio");
  await otherTab.getByRole("button", { name: `Account ${alice}`, exact: true }).click();
  await otherTab.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A trip that");
  await registerAccount(otherTab, bob);
  await expect(page.getByRole("button", { name: `Account ${bob}`, exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A trip that");
  const stale = await page.request.get("/api/trips", {
    headers: { "X-Tastip-Account": previousAccount },
  });
  expect(stale.status()).toBe(409);
  await otherTab.close();
});

test("a failed session check offers retry without opening an unverified workspace", async ({
  page,
}) => {
  await page.route("**/api/account", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Synthetic session outage" } } }),
  );
  await page.goto("/studio");
  await expect(
    page.getByRole("alert").filter({ hasText: "Your sign-in could not be checked" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
  await page.unroute("**/api/account");
  await page.getByRole("button", { name: "Retry sign-in check", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toContainText("A trip that");
  await page.route("**/api/account", (route) =>
    route.fulfill({ status: 503, json: { error: { message: "Synthetic focus-check outage" } } }),
  );
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(
    page.getByRole("alert").filter({ hasText: "Your sign-in could not be checked" }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveCount(0);
});
