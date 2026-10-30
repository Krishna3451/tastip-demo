import { expect, type Page, type Route, test } from "@playwright/test";
import { E2E_ORIGIN } from "./environment";

const alice = { id: "00000000-0000-4000-8000-000000000091", username: "maps-fixture-alice" };
const bob = { id: "00000000-0000-4000-8000-000000000092", username: "maps-fixture-bob" };
const keyA = "synthetic-browser-map-key-a";
const keyB = "synthetic-browser-map-key-b";
const enabled = (apiKey = keyA) => ({ enabled: true, provider: "google-maps-3d", apiKey });
const hostedOrigin = `http://maps-runtime.localhost:${new URL(E2E_ORIGIN).port}`;

// An explicitly synthetic SDK: intercepted before any Google request reaches the network.
const sdk = `(() => {
  const proof = window.__syntheticMaps ||= { created: 0, removed: 0, stopped: 0, flights: [] };
  class SyntheticMap extends HTMLElement {
    constructor(options) { super(); Object.assign(this, options); proof.created++; }
    connectedCallback() {
      this.textContent = 'Synthetic map attribution fixture';
      queueMicrotask(() => {
        const event = new Event('gmp-steadychange');
        Object.defineProperty(event, 'isSteady', { value: true });
        this.dispatchEvent(event);
      });
    }
    disconnectedCallback() { proof.removed++; }
    stopCameraAnimation() { proof.stopped++; }
    flyCameraTo(options) { proof.flights.push(options); }
  }
  customElements.define('tastip-synthetic-google-map', SyntheticMap);
  window.google = { maps: { importLibrary: async () => ({ Map3DElement: SyntheticMap }) } };
  window.__tastipGoogleMapsReady();
})();`;

async function setup(page: Page, options: { hosted?: boolean; ignoreConfigAbort?: boolean } = {}) {
  const sdkKeys: string[] = [];
  let account = alice;
  const owners: (string | undefined)[] = [];
  const held: Route[] = [];
  const heldAccounts: Route[] = [];
  let holdAccount = false;
  let config: unknown = { enabled: false };
  let hold = false;
  let status = 200;
  // .localhost resolves directly to this isolated server, but is outside the old exact-host gate.
  // Hosted HTTPS/session admission is independently tested by the server security-contract suite.
  await page.route(/https:\/\/(?:[^/]+\.)?(?:googleapis\.com|gstatic\.com)\//, (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "maps.googleapis.com" && url.pathname === "/maps/api/js") {
      sdkKeys.push(url.searchParams.get("key") ?? "");
      return route.fulfill({ contentType: "text/javascript", body: sdk });
    }
    return route.abort("blockedbyclient");
  });
  await page.route("**/api/account", (route) => {
    if (holdAccount) {
      heldAccounts.push(route);
      return;
    }
    return route.fulfill({ json: { account } });
  });
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { providers: { qloo: false, openai: false } } }),
  );
  await page.route("**/api/trips", (route) => route.fulfill({ json: { trips: [] } }));
  await page.route("**/api/profile", (route) =>
    route.fulfill({ json: { profile: null, revision: 0 } }),
  );
  await page.route("**/api/saved", (route) =>
    route.fulfill({ json: { workspace: null, revision: 0, updatedAt: null } }),
  );
  await page.route("**/api/maps/config", (route) => {
    owners.push(route.request().headers()["x-tastip-account"]);
    if (hold) {
      held.push(route);
      return;
    }
    return route.fulfill({ status, json: config });
  });
  if (options.ignoreConfigAbort) {
    await page.addInitScript(() => {
      const transport = window.fetch.bind(window);
      window.fetch = (input, init) => {
        const url = new URL(input instanceof Request ? input.url : String(input), location.href);
        // Simulate a transport that delivers a body despite AbortSignal, so late-result guards matter.
        return transport(
          input,
          url.pathname === "/api/maps/config" ? { ...init, signal: null } : init,
        );
      };
    });
  }
  const switchOwner = async (next: typeof alice) => {
    account = next;
    await page.evaluate(() => {
      window.dispatchEvent(new StorageEvent("storage", { key: "tastip.session.change.v1" }));
    });
  };
  return {
    owners,
    sdkKeys,
    held,
    heldAccounts,
    switchOwner,
    setAccountHold(value: boolean) {
      holdAccount = value;
    },
    setConfig(value: unknown, responseStatus = 200) {
      config = value;
      status = responseStatus;
    },
    setHold(value: boolean) {
      hold = value;
    },
    origin: options.hosted ? hostedOrigin : E2E_ORIGIN,
  };
}
async function paint(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}
const map = (page: Page) => page.locator('[data-map-provider="google"]');
const fallback = (page: Page) =>
  page.getByRole("img", { name: "Interactive globe focused on Lisbon.", exact: true });
async function proof(page: Page) {
  return page.evaluate(() => {
    const state = window as unknown as {
      __syntheticMaps?: { created: number; removed: number; stopped: number; flights: unknown[] };
    };
    return state.__syntheticMaps;
  });
}

for (const width of [375, 1440]) {
  test(`owner-bound runtime config enables the mocked SDK on a host-like development origin at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 950 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    const fixture = await setup(page, { hosted: true });
    fixture.setConfig(enabled());
    await page.goto(`${fixture.origin}/studio`);
    await expect(map(page)).toHaveAttribute("data-map-status", "ready");
    await expect(map(page)).toBeVisible();
    expect(new URL(page.url()).hostname).toBe("maps-runtime.localhost");
    expect(fixture.owners).toEqual([alice.id]);
    expect(fixture.sdkKeys).toEqual([keyA]);
    await expect(map(page).getByText("Synthetic map attribution fixture")).toBeVisible();
    await map(page).getByRole("button", { name: "View Lisbon in 3D", exact: true }).click();
    await expect(
      map(page).getByRole("button", { name: "Back to globe", exact: true }),
    ).toBeVisible();
    await expect
      .poll(async () => (await proof(page))?.flights)
      .toContainEqual({
        endCamera: {
          center: { lat: 38.7223, lng: -9.1393, altitude: 0 },
          range: 8000,
          tilt: 55,
          heading: 0,
        },
        durationMillis: 0,
      });
    expect(await page.evaluate(() => localStorage.getItem("tastip.trip.v1"))).toBeNull();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}

test("disabled, malformed and failed config never activates a legacy browser key", async ({
  page,
}) => {
  const fixture = await setup(page);
  // Run this file with a synthetic NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in the isolated dev server.
  for (const [body, status] of [
    [{ enabled: false }, 200],
    [enabled(), 503],
    [{ enabled: true, provider: "other", apiKey: keyA }, 200],
    [enabled("synthetic bad whitespace"), 200],
  ] as const) {
    fixture.setConfig(body, status);
    const expectedReads = fixture.owners.length + 1;
    const response = page.waitForResponse("**/api/maps/config");
    await page.goto("/studio");
    await (await response).finished();
    await paint(page);
    await expect(fallback(page)).toBeVisible();
    await expect.poll(() => fixture.owners.length).toBe(expectedReads);
    await expect(map(page)).toHaveCount(0);
    expect(fixture.sdkKeys).toEqual([]);
  }
});

test("unready identity and late previous-owner config cannot mount a map", async ({ page }) => {
  const fixture = await setup(page, { ignoreConfigAbort: true });
  fixture.setHold(true);
  fixture.setAccountHold(true);
  await page.goto("/studio");
  await expect.poll(() => fixture.heldAccounts.length).toBeGreaterThanOrEqual(1);
  expect(fixture.owners).toEqual([]);
  expect(fixture.sdkKeys).toEqual([]);
  fixture.setAccountHold(false);
  await Promise.all(
    fixture.heldAccounts.map((route) => route.fulfill({ json: { account: alice } })),
  );
  await expect.poll(() => fixture.held.length).toBe(1);
  await expect(fallback(page)).toBeVisible();
  fixture.setHold(false);
  fixture.setConfig({ enabled: false });
  await fixture.switchOwner(bob);
  await expect.poll(() => fixture.owners).toEqual([alice.id, bob.id]);
  await fixture.held[0]?.fulfill({ json: enabled() });
  await paint(page);
  await expect(map(page)).toHaveCount(0);
  await expect(fallback(page)).toBeVisible();
  expect(fixture.sdkKeys).toEqual([]);
  expect(await proof(page)).toBeUndefined();
});

test("config timeout and SDK auth failure retain fallback while navigation cleans a mounted map", async ({
  page,
}) => {
  const fixture = await setup(page, { ignoreConfigAbort: true });
  fixture.setHold(true);
  await page.clock.install();
  await page.goto("/studio");
  await expect.poll(() => fixture.held.length).toBe(1);
  await page.clock.fastForward(5_100);
  await fixture.held[0]?.fulfill({ json: enabled() });
  await page.clock.runFor(100);
  await expect(fallback(page)).toBeVisible();
  await expect(map(page)).toHaveCount(0);
  expect(fixture.sdkKeys).toEqual([]);
  fixture.setHold(false);
  fixture.setConfig(enabled());
  await page.reload();
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  // Google can reject credentials after its library promise has already resolved.
  await page.evaluate(() => {
    const sdk = window as unknown as { gm_authFailure?: () => void };
    if (!sdk.gm_authFailure)
      throw new Error("The mounted map must retain its auth-failure callback.");
    sdk.gm_authFailure();
  });
  await expect(fallback(page)).toBeVisible();
  await expect(map(page)).toHaveCount(0);
  expect((await proof(page))?.removed).toBe(1);
  expect(fixture.sdkKeys).toEqual([keyA]);
  await page.reload();
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  await page.getByRole("link", { name: "Saved", exact: true }).click();
  await expect(map(page)).toHaveCount(0);
  await expect.poll(async () => (await proof(page))?.removed).toBe(1);
  expect((await proof(page))?.stopped).toBeGreaterThan(0);
});

test("owner changes remove the old map immediately and rotating SDK keys requires reload", async ({
  page,
}) => {
  const fixture = await setup(page);
  fixture.setConfig(enabled());
  await page.goto("/studio");
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  fixture.setHold(true);
  await fixture.switchOwner(bob);
  await expect.poll(() => fixture.held.length).toBe(1);
  await expect(map(page)).toHaveCount(0);
  await expect(fallback(page)).toBeVisible();
  expect((await proof(page))?.removed).toBe(1);
  await fixture.held[0]?.fulfill({ json: enabled(keyB) });
  await paint(page);
  await expect(fallback(page)).toBeVisible();
  await expect(map(page)).toHaveCount(0);
  expect(fixture.sdkKeys).toEqual([keyA]);
  expect((await proof(page))?.created).toBe(1);
  fixture.setHold(false);
  fixture.setConfig(enabled(keyB));
  await page.reload();
  await expect(map(page)).toHaveAttribute("data-map-status", "ready");
  expect(fixture.sdkKeys).toEqual([keyA, keyB]);
  expect(fixture.owners).toEqual([alice.id, bob.id, bob.id]);
});
