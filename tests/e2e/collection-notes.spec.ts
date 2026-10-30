import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import type { SavedWorkspace } from "../../apps/web/src/features/planner/lib/saved-workspace";
import { createDemoTrip, DEFAULT_BRIEF, DESTINATIONS, type Place } from "../../packages/domain/src";
import { E2E_ORIGIN } from "./environment";

const collectionId = "00000000-0000-4000-8000-000000000093";
const otherCollectionId = "00000000-0000-4000-8000-000000000094";
const name = "Synthetic private note collection";
const place: Place = {
  id: "qloo:collection-note-fixture",
  destinationId: "lisbon",
  name: "Synthetic note café",
  description: "Synthetic collection note browser fixture, not a live venue.",
  source: "qloo",
  category: "cafe",
  lat: 38.72,
  lng: -9.13,
  taste: { queryId: "collection-note-query", rank: 7 },
  practical: { hours: "unknown", cost: "unknown" },
  facts: {
    source: "qloo",
    retrievedAt: "2026-10-30T12:00:00Z",
    address: "Synthetic fixture address",
  },
};
const workspace: SavedWorkspace = {
  places: [{ place, destination: DESTINATIONS[0]! }],
  collections: [{ id: collectionId, name, placeIds: [place.id] }],
};
function noteRegion(page: Page) {
  return page.getByRole("region", { name: `Private note for ${place.name}`, exact: true });
}
async function beginNote(page: Page) {
  const region = noteRegion(page);
  await region.getByRole("button", { name: /^(Add|Edit) note for/ }).click();
  return region.getByRole("textbox", { name: `Note for ${place.name}`, exact: true });
}
async function editNote(page: Page, text: string) {
  await (await beginNote(page)).fill(text);
  await noteRegion(page).getByRole("button", { name: "Save note", exact: true }).click();
}
async function register(context: BrowserContext) {
  const username = `notes_${crypto.randomUUID().slice(0, 12)}`;
  const password = "Synthetic-notes-password-9384";
  const response = await context.request.post(`${E2E_ORIGIN}/api/account`, {
    headers: { Origin: E2E_ORIGIN },
    data: { action: "register", username, password },
  });
  expect(response.ok()).toBe(true);
  return { ...(await response.json()).account, username, password };
}
async function read(context: BrowserContext, id: string) {
  const response = await context.request.get(`${E2E_ORIGIN}/api/saved`, {
    headers: { "X-Tastip-Account": id },
  });
  expect(response.ok()).toBe(true);
  return response.json();
}
async function save(context: BrowserContext, id: string, next: SavedWorkspace, revision: number) {
  const response = await context.request.post(`${E2E_ORIGIN}/api/saved`, {
    headers: { Origin: E2E_ORIGIN, "X-Tastip-Account": id },
    data: { action: "save", workspace: next, expectedRevision: revision },
  });
  expect(response.ok()).toBe(true);
}

for (const width of [375, 1440]) {
  test(`private collection note drafts save, cancel, clear and import without changing the trip at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 1000 });
    const trip = createDemoTrip(DEFAULT_BRIEF);
    const initial = {
      ...workspace,
      collections: [
        ...workspace.collections,
        {
          id: otherCollectionId,
          name: "Other private collection",
          placeIds: [place.id],
          placeNotes: { [place.id]: "Separate collection note." },
        },
      ],
    };
    await page.addInitScript(
      ({ initial, trip }) => {
        if (!localStorage.getItem("tastip.reference.collections:guest")) {
          localStorage.setItem("tastip.reference.saved:guest", JSON.stringify(initial.places));
          localStorage.setItem(
            "tastip.reference.collections:guest",
            JSON.stringify(initial.collections),
          );
          localStorage.setItem("tastip.trip.v1", JSON.stringify(trip));
        }
      },
      { initial, trip },
    );
    await page.goto(`/saved?collection=${collectionId}`);
    await (await beginNote(page)).fill("Discard this unsaved note.");
    await noteRegion(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(
      noteRegion(page).getByText("Discard this unsaved note.", { exact: true }),
    ).toHaveCount(0);
    const note = "Check the courtyard entrance.\n  Keep this indentation.";
    await editNote(page, note);
    await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText(note);
    const saved = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
    );
    expect(saved.collections[0]).toEqual({
      ...workspace.collections[0],
      placeNotes: { [place.id]: note },
    });
    expect(saved.places).toEqual(workspace.places);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    await page.reload();
    await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText(note);
    await page.goto(`/saved?collection=${otherCollectionId}`);
    await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText(
      "Separate collection note.",
    );
    await (await beginNote(page)).fill("Another unsaved collection draft.");
    await noteRegion(page).getByRole("button", { name: "Cancel", exact: true }).click();
    await page.goto(`/saved?collection=${collectionId}`);
    await editNote(page, "");
    await expect(
      noteRegion(page).getByRole("button", { name: `Add note for ${place.name}`, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        (placeId) =>
          JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null")
            .collections[0].placeNotes[placeId],
        place.id,
      ),
    ).toBe("");
    await editNote(page, note);

    const imported = {
      id: "00000000-0000-4000-8000-000000000095",
      name: "Imported private notes",
      placeIds: [place.id, "legacy-orphan"],
      placeNotes: {
        [place.id]: "Imported note.",
        "legacy-orphan": "Preserved until its place arrives.",
      },
    };
    await page.locator('input[type="file"]').setInputFiles({
      name: "synthetic-note-collection.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    const info = page.getByRole("dialog", { name: "Collections", exact: true });
    await expect(info).toContainText("Collection imported.");
    await info.getByRole("button", { name: "Close", exact: true }).click();
    const afterImport: SavedWorkspace = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
    );
    expect(
      afterImport.collections.find((item) => item.id === collectionId)?.placeNotes?.[place.id],
    ).toBe(note);
    expect(afterImport.collections.find((item) => item.name === imported.name)?.placeNotes).toEqual(
      imported.placeNotes,
    );
    expect(afterImport.places).toEqual(workspace.places);
    expect(
      await page.evaluate(() => JSON.parse(localStorage.getItem("tastip.trip.v1") ?? "null")),
    ).toEqual(trip);
    await page.goto("/saved?view=places");
    await expect(page.getByRole("button", { name: /^(Add|Edit) note for/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("account note conflicts keep the account version and preserve the private device draft before explicit combination", async ({
  browser,
  context,
  page,
}) => {
  const account = await register(context);
  const initial: SavedWorkspace = {
    ...workspace,
    collections: [{ ...workspace.collections[0]!, placeNotes: { [place.id]: "Original note." } }],
  };
  await save(context, account.id, initial, 0);
  const second = await browser.newContext();
  const otherOwner = await browser.newContext();
  try {
    const login = await second.request.post(`${E2E_ORIGIN}/api/account`, {
      headers: { Origin: E2E_ORIGIN },
      data: { action: "login", username: account.username, password: account.password },
    });
    expect(login.ok()).toBe(true);
    const otherPage = await second.newPage();
    await page.goto(`/saved?collection=${collectionId}`);
    await otherPage.goto(`/saved?collection=${collectionId}`);
    await expect(noteRegion(otherPage).locator(".mt-collection-note-text")).toHaveText(
      "Original note.",
    );
    await editNote(page, "Account note wins this conflict.");
    await expect.poll(async () => (await read(context, account.id)).revision).toBe(2);
    await editNote(otherPage, "Different private device note.");
    await expect(
      otherPage.getByRole("region", { name: "Saved storage", exact: true }).getByRole("alert"),
    ).toContainText(/another|changed/i);
    expect((await read(context, account.id)).workspace.collections[0].placeNotes[place.id]).toBe(
      "Account note wins this conflict.",
    );
    await otherPage.getByRole("button", { name: "Review account saves", exact: true }).click();
    const review = otherPage.getByRole("dialog", { name: "Review account saves", exact: true });
    await expect(review).toContainText("conflicting notes are kept");
    await review.getByRole("button", { name: "Combine both copies", exact: true }).click();
    await expect.poll(async () => (await read(context, account.id)).revision).toBe(3);
    await expect(noteRegion(otherPage).locator(".mt-collection-note-text")).toHaveText(
      "Account note wins this conflict.",
    );
    const recovery = await otherPage.evaluate(
      (id) => JSON.parse(localStorage.getItem(`tastip.reference.saved-recovery:${id}`) ?? "null"),
      account.id,
    );
    expect(recovery.collections[0].placeNotes[place.id]).toBe("Different private device note.");
    expect(recovery.collections[0].id).toBe(collectionId);
    expect(recovery.places[0].place.taste).toEqual(place.taste);
    await otherPage.reload();
    await expect(noteRegion(otherPage).locator(".mt-collection-note-text")).toHaveText(
      "Account note wins this conflict.",
    );
    const outsider = await register(otherOwner);
    expect((await read(otherOwner, outsider.id)).workspace).toBeNull();
    const outsiderPage = await otherOwner.newPage();
    await outsiderPage.goto(`/saved?collection=${collectionId}`);
    await expect(
      outsiderPage.getByRole("heading", { name: "Collection unavailable", exact: true }),
    ).toBeVisible();
    await expect(
      outsiderPage.getByText("Account note wins this conflict.", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await second.close();
    await otherOwner.close();
  }
});

test("reviewing a newer account note preserves an open local draft and rejects its stale save", async ({
  context,
  page,
}) => {
  const account = await register(context);
  const initial: SavedWorkspace = {
    ...workspace,
    collections: [
      { ...workspace.collections[0]!, placeNotes: { [place.id]: "Original account note." } },
    ],
  };
  await save(context, account.id, initial, 0);
  await page.goto(`/saved?collection=${collectionId}`);
  await (await beginNote(page)).fill("Unsent editor draft.");
  const newer: SavedWorkspace = {
    ...workspace,
    collections: [
      { ...workspace.collections[0]!, placeNotes: { [place.id]: "Newer account note." } },
    ],
  };
  await save(context, account.id, newer, 1);
  await page.getByRole("button", { name: "Review account saves", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Review account saves", exact: true })
    .getByRole("button", { name: "Use account copy", exact: true })
    .click();
  await noteRegion(page).getByRole("button", { name: "Save note", exact: true }).click();
  await expect(noteRegion(page).getByRole("alert")).toContainText("This note changed");
  await expect(noteRegion(page).getByRole("textbox")).toHaveValue("Unsent editor draft.");
  expect((await read(context, account.id)).revision).toBe(2);
  expect((await read(context, account.id)).workspace.collections[0].placeNotes[place.id]).toBe(
    "Newer account note.",
  );
  await noteRegion(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText(
    "Newer account note.",
  );
  await expect(await beginNote(page)).toHaveValue("Newer account note.");
});

for (const accountBacked of [false, true]) {
  test(`a delayed collection import keeps a concurrent ${accountBacked ? "account" : "guest"} note and retains the file for explicit retry`, async ({
    context,
    page,
  }) => {
    const initial: SavedWorkspace = {
      ...workspace,
      collections: [{ ...workspace.collections[0]!, placeNotes: { [place.id]: "Initial note." } }],
    };
    const account = accountBacked ? await register(context) : null;
    if (account) await save(context, account.id, initial, 0);
    else
      await page.addInitScript((value) => {
        if (!localStorage.getItem("tastip.reference.saved-workspace:guest"))
          localStorage.setItem("tastip.reference.saved-workspace:guest", JSON.stringify(value));
      }, initial);
    // Delay only this synthetic File read; the app stays usable while it is opening.
    await page.addInitScript(() => {
      const original = File.prototype.text;
      const gate = { reads: 0, release: () => {} };
      File.prototype.text = function () {
        if (this.name !== "delayed-note-import.json" || gate.reads++ > 0)
          return original.call(this);
        return new Promise<string>((resolve, reject) => {
          gate.release = () => {
            void original.call(this).then(resolve, reject);
          };
        });
      };
      Object.assign(window, { __collectionImportGate: gate });
    });
    await page.goto(`/saved?collection=${collectionId}`);
    await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText("Initial note.");
    const imported = {
      id: "00000000-0000-4000-8000-000000000096",
      name: "Delayed imported collection",
      placeIds: [place.id],
      placeNotes: { [place.id]: "Imported collection note." },
    };
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles({
      name: "delayed-note-import.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(imported)),
    });
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as unknown as { __collectionImportGate: { reads: number } })
              .__collectionImportGate.reads,
        ),
      )
      .toBe(1);
    await editNote(page, "Concurrent note must survive importing.");
    await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText(
      "Concurrent note must survive importing.",
    );
    if (account) await expect.poll(async () => (await read(context, account.id)).revision).toBe(2);
    await page.evaluate(() =>
      (
        window as unknown as { __collectionImportGate: { release: () => void } }
      ).__collectionImportGate.release(),
    );
    const info = page.getByRole("dialog", { name: "Collections", exact: true });
    await expect(info).toContainText("Nothing was imported");
    await expect(info).toContainText("Your file is kept");
    await info.getByRole("button", { name: "Close", exact: true }).click();
    await expect(noteRegion(page).locator(".mt-collection-note-text")).toHaveText(
      "Concurrent note must survive importing.",
    );
    expect(await fileInput.evaluate((input) => (input as HTMLInputElement).files?.[0]?.name)).toBe(
      "delayed-note-import.json",
    );
    const beforeRetry: SavedWorkspace = account
      ? (await read(context, account.id)).workspace
      : await page.evaluate(() =>
          JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
        );
    expect(beforeRetry.collections).toHaveLength(1);
    expect(beforeRetry.collections[0]?.placeNotes?.[place.id]).toBe(
      "Concurrent note must survive importing.",
    );
    await page.getByRole("button", { name: "Retry import", exact: true }).click();
    await expect(info).toContainText("Collection imported.");
    await info.getByRole("button", { name: "Close", exact: true }).click();
    if (account) await expect.poll(async () => (await read(context, account.id)).revision).toBe(3);
    const afterRetry: SavedWorkspace = account
      ? (await read(context, account.id)).workspace
      : await page.evaluate(() =>
          JSON.parse(localStorage.getItem("tastip.reference.saved-workspace:guest") ?? "null"),
        );
    expect(afterRetry.collections).toHaveLength(2);
    expect(
      afterRetry.collections.find((item) => item.id === collectionId)?.placeNotes?.[place.id],
    ).toBe("Concurrent note must survive importing.");
    expect(afterRetry.collections.find((item) => item.name === imported.name)?.placeNotes).toEqual(
      imported.placeNotes,
    );
    expect(afterRetry.places).toEqual(initial.places);
    await expect(page.getByRole("button", { name: "Retry import", exact: true })).toHaveCount(0);
  });
}
