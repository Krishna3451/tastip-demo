import { expect, test } from "@playwright/test";
import { createDemoTrip, DEFAULT_BRIEF } from "../../packages/domain/src";

test("reference entry creates an empty saved draft with confirmed travelers and flexible dates", async ({
  page,
}) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: "Build my trip", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create a trip", exact: true });
  await create
    .getByLabel("What should I keep in mind for this trip?")
    .fill("Lisbon for a relaxed museum and coffee trip.");
  await create.getByRole("button", { name: "Where Select destination", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Where", exact: true })
    .getByRole("button", { name: /Lisbon/ })
    .click();
  await page
    .getByRole("dialog", { name: "Where", exact: true })
    .getByRole("button", { name: "Save", exact: true })
    .click();
  await create.getByRole("button", { name: "When Select dates", exact: true }).click();
  const when = page.getByRole("dialog", { name: "When", exact: true });
  await when.getByRole("button", { name: "Flexible", exact: true }).click();
  await when.getByRole("button", { name: "More days", exact: true }).click();
  await when.press("Escape");
  await expect(create).toBeVisible();
  await create.getByRole("button", { name: "When Select dates", exact: true }).click();
  await when.getByRole("button", { name: "Flexible", exact: true }).click();
  await when.getByRole("button", { name: "More days", exact: true }).click();
  await when.getByRole("button", { name: "Update", exact: true }).click();
  await create.getByRole("button", { name: "Who Add people", exact: true }).click();
  const who = page.getByRole("dialog", { name: "Who", exact: true });
  await who.getByRole("button", { name: "More adults", exact: true }).click();
  await who.getByRole("button", { name: "Update", exact: true }).click();
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/trip\//);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lisbon", exact: true })).toBeVisible();
  const trip = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  expect(trip.brief.days).toBe(6);
  expect(trip.brief.partySize).toBe(2);
  expect(trip.brief.details.request).toContain("relaxed museum");
  expect(trip.stops).toEqual([]);
});

test("itinerary comments and trip title persist to the canonical draft", async ({ page }) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  await page.addInitScript(
    (value) => localStorage.setItem("tastip.trip.v1", JSON.stringify(value)),
    trip,
  );
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: /^Itinerary/ }).click();
  const sheet = page.getByRole("region", { name: "Trip itinerary" });
  await sheet
    .getByRole("button", {
      name: `Comment on ${trip.places.find((place) => place.id === trip.stops[0]!.placeId)!.name}`,
    })
    .click();
  const comment = page.getByRole("dialog", { name: "Add a comment", exact: true });
  await comment.getByLabel("Comment", { exact: true }).fill("Meet by the entrance");
  await comment.getByRole("button", { name: "Update", exact: true }).click();
  await expect(sheet.getByText("Meet by the entrance", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close itinerary", exact: true }).click();
  await page
    .getByRole("button", { name: "Lisbon", exact: false })
    .filter({ has: page.locator("h1") })
    .click();
  const title = page.getByRole("dialog", { name: "Edit trip title", exact: true });
  await title.getByLabel("Trip title", { exact: true }).fill("My Portugal trip");
  await title.getByRole("button", { name: "Update", exact: true }).click();
  // Read the app-written draft rather than the initial fixture.
  const stored = await page.evaluate(() => localStorage.getItem("tastip.trip.v1"));
  expect(stored).toContain("Meet by the entrance");
  expect(stored).toContain("My Portugal trip");
});

test("mobile entry has usable navigation without horizontal page overflow", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/discover");
  await expect(page.getByRole("button", { name: "Build my trip", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Guest Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Trips", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Your trips", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("navigation drawers preserve the page and chats can be renamed, archived and restored", async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem("tastip.reference.chats:guest")) return;
    localStorage.setItem(
      "tastip.reference.chats:guest",
      JSON.stringify([
        {
          id: "test-chat",
          title: "Portugal plans",
          updatedAt: 1,
          messages: [{ id: "m1", role: "user", text: "Plan Lisbon" }],
        },
      ]),
    );
  });
  await page.goto("/trips");
  const navigation = page.getByRole("complementary", { name: "Main navigation" });
  await navigation.getByRole("button", { name: "Chats", exact: true }).click();
  await expect(page).toHaveURL(/\/trips$/);
  const chats = page.getByRole("region", { name: "Chats", exact: true });
  await chats.getByRole("button", { name: "Options for Portugal plans", exact: true }).click();
  await chats.getByRole("menuitem", { name: "Rename", exact: true }).click();
  const rename = page.getByRole("dialog", { name: "Rename chat", exact: true });
  await rename.getByLabel("Chat name", { exact: true }).fill("Spring in Lisbon");
  await rename.getByRole("button", { name: "Update", exact: true }).click();
  await chats.getByRole("button", { name: "Options for Spring in Lisbon", exact: true }).click();
  await chats.getByRole("menuitem", { name: "Archive chat", exact: true }).click();
  await expect(chats.getByRole("link", { name: "Spring in Lisbon", exact: true })).toHaveCount(0);
  await chats.getByRole("button", { name: "Archived", exact: true }).click();
  await chats.getByRole("button", { name: "Options for Spring in Lisbon", exact: true }).click();
  await chats.getByRole("menuitem", { name: "Restore chat", exact: true }).click();
  await chats.getByRole("button", { name: "Back", exact: true }).click();
  await chats.getByRole("link", { name: "Spring in Lisbon", exact: true }).click();
  await expect(
    page
      .getByRole("region", { name: "Travel conversation" })
      .locator(".chat-message")
      .filter({ hasText: "Plan Lisbon" }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page
      .getByRole("region", { name: "Travel conversation" })
      .locator(".chat-message")
      .filter({ hasText: "Plan Lisbon" }),
  ).toBeVisible();
});

test("personalization preferences persist and account menu opens settings", async ({ page }) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: "Guest Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Personalization", exact: true }).click();
  await expect(page).toHaveURL(/section=personalization/);
  await page.getByRole("radio", { name: "Cedar", exact: true }).check();
  await page
    .getByRole("combobox", { name: "Communication style", exact: true })
    .selectOption("concise");
  await page.getByRole("switch", { name: "Long-term memory", exact: true }).click();
  await page.reload();
  await expect(page.getByRole("radio", { name: "Cedar", exact: true })).toBeChecked();
  await expect(
    page.getByRole("combobox", { name: "Communication style", exact: true }),
  ).toHaveValue("concise");
  await expect(
    page.getByRole("switch", { name: "Long-term memory", exact: true }),
  ).not.toBeChecked();
});

test("a free-text multi-city trip keeps its flexible month and explicit traveler counts", async ({
  page,
}) => {
  await page.goto("/discover");
  await page.getByRole("button", { name: "Build my trip", exact: true }).click();
  const create = page.getByRole("dialog", { name: "Create a trip", exact: true });
  await create
    .getByLabel("What should I keep in mind for this trip?")
    .fill("Lisbon and Porto for 5 days in March 2027 with 2 adults and 1 child");
  await create.getByRole("button", { name: "Create", exact: true }).click();
  await expect(page).toHaveURL(/\/trip\//);
  await expect(page.getByRole("heading", { name: "Lisbon → Porto", exact: true })).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  expect(stored.route.startDate).toBeNull();
  expect(
    stored.route.stays.map((stay: { destinationId: string; days: number }) => [
      stay.destinationId,
      stay.days,
    ]),
  ).toEqual([
    ["lisbon", 3],
    ["porto", 2],
  ]);
  expect(stored.days.every((day: { date: string | null }) => day.date === null)).toBe(true);
  expect(stored.brief.partySize).toBe(3);
  expect(stored.brief.details.flexibleMonths).toEqual(["2027-03"]);
  expect(stored.stops).toEqual([]);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Lisbon → Porto", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Trips", exact: true }).click();
  await page.getByRole("combobox", { name: "Trip view", exact: true }).selectOption("Unscheduled");
  await expect(page.getByRole("heading", { name: "Lisbon → Porto", exact: true })).toBeVisible();
});

test("media links and receipt files persist privately, and removing a file can be undone", async ({
  page,
}) => {
  const trip = createDemoTrip(DEFAULT_BRIEF);
  await page.addInitScript((value) => {
    if (!localStorage.getItem("tastip.trip.v1"))
      localStorage.setItem("tastip.trip.v1", JSON.stringify(value));
  }, trip);
  await page.goto(`/trip/${trip.id}`);
  await page.getByRole("button", { name: "Media", exact: true }).click();
  let media = page.getByRole("region", { name: "Trip media", exact: true });
  await media.getByRole("button", { name: "Add media", exact: true }).click();
  await media.getByRole("menuitem", { name: /Add a link/ }).click();
  const link = page.getByRole("dialog", { name: "Add a link", exact: true });
  await link
    .getByLabel("Paste a link to website or video…", { exact: true })
    .fill("https://example.com/travel-guide");
  await link.getByRole("button", { name: "Add", exact: true }).click();
  await expect(media.getByRole("link", { name: "Open link", exact: true })).toHaveAttribute(
    "href",
    "https://example.com/travel-guide",
  );
  await media.getByLabel("Upload media file", { exact: true }).setInputFiles({
    name: "reference-receipt.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.7\nSynthetic browser fixture"),
  });
  await expect(media.getByRole("link", { name: "Download", exact: true })).toBeVisible();
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null"),
  );
  expect(stored.media).toHaveLength(2);
  expect(JSON.stringify(stored)).not.toContain("Synthetic browser fixture");
  await page.reload();
  await page.getByRole("button", { name: /^Media/ }).click();
  media = page.getByRole("region", { name: "Trip media", exact: true });
  await expect(media.getByRole("link", { name: "Download", exact: true })).toBeVisible();
  await media
    .getByRole("button", { name: "Options for reference-receipt.pdf", exact: true })
    .click();
  await media.getByRole("menuitem", { name: "Remove from trip", exact: true }).click();
  await expect(media.getByText("reference-receipt.pdf", { exact: true })).toHaveCount(0);
  await media.getByRole("button", { name: "Close media", exact: true }).click();
  await page.getByRole("button", { name: "More trip options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Undo last change", exact: true }).click();
  await page.getByRole("button", { name: /^Media/ }).click();
  await expect(media.getByRole("link", { name: "Download", exact: true })).toBeVisible();
});

test("sign-out hides private drafts while preserving them for the owning account", async ({
  page,
}) => {
  const owned = { ...createDemoTrip(DEFAULT_BRIEF), title: "Private account trip" };
  const guest = { ...createDemoTrip(DEFAULT_BRIEF), title: "Guest trip" };
  let account: { id: string; username: string } | null = {
    id: "00000000-0000-4000-8000-000000000001",
    username: "synthetic-owner",
  };
  await page.route("**/api/account", async (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON();
      account =
        body.action === "logout"
          ? null
          : {
              id: "00000000-0000-4000-8000-000000000001",
              username: "synthetic-owner",
            };
    }
    await route.fulfill({ json: { account } });
  });
  await page.addInitScript(
    ({ owned, guest }) => {
      if (!localStorage.getItem("tastip.trip.v1:00000000-0000-4000-8000-000000000001"))
        localStorage.setItem(
          "tastip.trip.v1:00000000-0000-4000-8000-000000000001",
          JSON.stringify(owned),
        );
      if (!localStorage.getItem("tastip.trip.v1"))
        localStorage.setItem("tastip.trip.v1", JSON.stringify(guest));
    },
    { owned, guest },
  );
  await page.goto(`/trip/${owned.id}`);
  await expect(page.getByRole("heading", { name: owned.title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "synthetic-owner Menu", exact: true }).click();
  await page.getByRole("menuitem", { name: "Log out", exact: true }).click();
  await expect(page).toHaveURL(/\/home$/);
  await expect(page.getByRole("button", { name: "Sign in to Tastip", exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: owned.title, exact: true })).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("tastip.trip.v1:00000000-0000-4000-8000-000000000001"),
    ),
  ).toContain(owned.title);
  expect(await page.evaluate(() => localStorage.getItem("tastip.trip.v1"))).not.toContain(
    owned.title,
  );
  await page.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  const signIn = page.getByRole("dialog", { name: "Tastip account", exact: true });
  await signIn.getByLabel("Account username", { exact: true }).fill("synthetic-owner");
  await signIn.getByLabel("Account password", { exact: true }).fill("synthetic-test-password");
  await signIn
    .getByRole("checkbox", { name: "Keep my current draft in this account’s browser workspace" })
    .uncheck();
  await signIn.getByRole("button", { name: "Sign in to Tastip", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Account synthetic-owner", exact: true }),
  ).toBeVisible();
  await page.goto(`/trip/${owned.id}`);
  await expect(page.getByRole("heading", { name: owned.title, exact: true })).toBeVisible();
});
