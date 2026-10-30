import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src/fixtures";
import type { TasteProfile } from "../../packages/domain/src/types";
import { E2E_ORIGIN } from "./environment";

test("saved tastes survive another browser, remain private, can be reused and forgotten", async ({
  page,
  browser,
}) => {
  const profile: TasteProfile = {
    seeds: [
      { id: "synthetic-film-profile", name: "Synthetic Film Favorite", type: "urn:entity:movie" },
    ],
    dayStyle: "A little of everything",
    categories: [],
    rhythm: "late" as const,
    dietary: ["Vegetarian"],
    walking: "short" as const,
    lodging: "Boutique & character",
  };
  const trip = createDemoTrip({ ...DEFAULT_BRIEF, tasteProfile: profile });
  await page.addInitScript(
    (trip) => localStorage.setItem("tastip.trip.v1", JSON.stringify(trip)),
    trip,
  );
  await page.goto("/studio");
  const username = `profile_${crypto.randomUUID().slice(0, 12)}`;
  const password = "Synthetic-profile-password-1749";
  await page.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  const accountDialog = page.getByRole("dialog", { name: "Tastip account" });
  await accountDialog.getByRole("button", { name: "Create account", exact: true }).click();
  await accountDialog.getByLabel("Account username").fill(username);
  await accountDialog.getByLabel("Account password").fill(password);
  await accountDialog.getByRole("button", { name: "Create my account" }).click();
  await expect(accountDialog).not.toBeVisible();
  await page.getByRole("button", { name: `Account ${username}`, exact: true }).click();
  await accountDialog.getByRole("button", { name: "Save preferences from this trip" }).click();
  await expect(accountDialog.getByRole("status")).toContainText(
    "Preferences saved to this account",
  );
  const account = (await (await page.request.get("/api/account")).json()).account;
  const privateHeaders = { "X-Tastip-Account": account.id };
  const first = await (await page.request.get("/api/profile", { headers: privateHeaders })).json();
  expect(first.profile).toEqual(profile);
  expect(
    (
      await page.request.get("/api/profile", { headers: { "X-Tastip-Account": "another-account" } })
    ).status(),
  ).toBe(409);
  expect(
    (
      await page.request.post("/api/profile", {
        headers: { ...privateHeaders, Origin: "https://unrelated.example" },
        data: { action: "forget", expectedRevision: first.revision },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.post("/api/profile", {
        headers: { ...privateHeaders, Origin: E2E_ORIGIN },
        data: {
          action: "save",
          profile: { ...profile, seeds: Array(21).fill(profile.seeds[0]) },
          expectedRevision: first.revision,
        },
      })
    ).status(),
  ).toBe(400);
  const other = await browser.newContext();
  try {
    expect((await other.request.get("/api/profile", { headers: privateHeaders })).status()).toBe(
      401,
    );
    await other.request.post("/api/account", {
      headers: { Origin: E2E_ORIGIN },
      data: { action: "login", username, password },
    });
    const next = await other.newPage();
    await next.goto("/studio");
    await next.getByRole("button", { name: "Find my kind of places" }).click();
    const studio = next.getByRole("dialog", { name: "Create your taste-led trip" });
    await studio.getByRole("button", { name: "Use saved preferences" }).click();
    await expect(
      studio.getByRole("button", { name: "Remove Synthetic Film Favorite favorite", exact: true }),
    ).toBeVisible();
    await studio.getByRole("button", { name: "Continue", exact: true }).click();
    await studio.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(studio.getByRole("button", { name: /Late starts & evenings/ })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await studio.getByRole("button", { name: /Early light/ }).click();
    await studio.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(studio.getByText(/early light, 8 AM–7 PM/)).toBeVisible();
    expect(
      (await (await other.request.get("/api/profile", { headers: privateHeaders })).json()).profile
        .rhythm,
    ).toBe("late");
    await studio.getByRole("button", { name: "Forget saved preferences" }).click();
    await expect(studio.getByRole("status")).toContainText("Saved preferences forgotten");
    const stale = await page.request.post("/api/profile", {
      headers: { ...privateHeaders, Origin: E2E_ORIGIN },
      data: { action: "save", profile, expectedRevision: first.revision },
    });
    expect(stale.status()).toBe(409);
    await accountDialog.getByRole("button", { name: "Save preferences from this trip" }).click();
    await expect(accountDialog.getByRole("alert")).toContainText("another tab");
    await accountDialog.getByRole("button", { name: "Reload saved preferences" }).click();
    await expect(accountDialog.getByText("No preferences saved yet.")).toBeVisible();
    await accountDialog.getByRole("button", { name: "Close account" }).click();
    // Forgetting the account default does not rewrite the existing accepted trip.
    const acceptedProfile = await page.evaluate(
      (id) =>
        JSON.parse(localStorage.getItem(`tastip.trip.v1:${id}`) ?? "null")?.brief.tasteProfile,
      account.id,
    );
    expect(acceptedProfile).toEqual(profile);
    expect(
      (await (await page.request.get("/api/profile", { headers: privateHeaders })).json()).profile,
    ).toBeNull();
  } finally {
    await other.close();
  }
});
