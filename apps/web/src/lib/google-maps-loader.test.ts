import { expect, test } from "bun:test";
import { type GoogleMaps3DLibrary, loadGoogleMaps3D } from "./google-maps-loader";

test("Google loader shares one request, isolates cancellation and cleans failed loads", async () => {
  class Script extends EventTarget {
    src = "";
    async = false;
    nonce = "";
    dataset: Record<string, string> = {};
    removed = false;
    remove() {
      this.removed = true;
    }
  }
  const scripts: Script[] = [];
  const browser: {
    setTimeout: typeof globalThis.setTimeout;
    clearTimeout: typeof globalThis.clearTimeout;
    __tastipGoogleMapsReady?: () => void;
    google?: { maps: { importLibrary: (name: string) => Promise<GoogleMaps3DLibrary> } };
  } = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => new Script(),
      querySelector: () => null,
      head: { appendChild: (script: Script) => scripts.push(script) },
    },
  });
  try {
    await expect(loadGoogleMaps3D("", new AbortController().signal)).rejects.toThrow("required");
    expect(scripts).toHaveLength(0);

    const owner = new AbortController();
    const first = loadGoogleMaps3D("test-browser-key", owner.signal);
    const cancelled = new AbortController();
    const second = loadGoogleMaps3D("test-browser-key", cancelled.signal);
    cancelled.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    expect(scripts).toHaveLength(1);
    const script = scripts[0];
    expect(new URL(script?.src ?? "").searchParams.get("v")).toBe("weekly");
    expect(new URL(script?.src ?? "").searchParams.get("libraries")).toBe("maps3d");
    script?.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("could not load");
    expect(script?.removed).toBe(true);
    expect(browser.__tastipGoogleMapsReady).toBeUndefined();

    const library = { Map3DElement: class {} } as unknown as GoogleMaps3DLibrary;
    let imports = 0;
    const retry = loadGoogleMaps3D("test-browser-key", new AbortController().signal);
    browser.google = {
      maps: {
        importLibrary: async (name) => {
          expect(name).toBe("maps3d");
          imports++;
          return library;
        },
      },
    };
    browser.__tastipGoogleMapsReady?.();
    expect(await retry).toBe(library);
    expect(browser.__tastipGoogleMapsReady).toBeUndefined();
    expect(await loadGoogleMaps3D("test-browser-key", new AbortController().signal)).toBe(library);
    expect(imports).toBe(1);
    expect(scripts).toHaveLength(2);
    await expect(
      loadGoogleMaps3D("different-account-key", new AbortController().signal),
    ).rejects.toThrow("already configured");
    expect(scripts).toHaveLength(2);
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
});

type MockBrowser = {
  setTimeout: (callback: () => void, milliseconds: number) => number;
  clearTimeout: (timer: number) => void;
  gm_authFailure?: () => void;
  __tastipGoogleMapsReady?: () => void;
  google?: { maps: { importLibrary: (name: string) => Promise<GoogleMaps3DLibrary> } };
};

async function freshPage(
  name: string,
  run: (fixture: {
    browser: MockBrowser;
    scripts: Array<{ removed: boolean }>;
    timers: Map<number, () => void>;
    load: typeof loadGoogleMaps3D;
  }) => Promise<void>,
) {
  // Each module instance represents a new page; no reset-only production API is needed.
  const { loadGoogleMaps3D: load } = await import(`./google-maps-loader.ts?page=${name}`);
  const timers = new Map<number, () => void>();
  let nextTimer = 0;
  const browser: MockBrowser = {
    setTimeout: (callback) => {
      const timer = ++nextTimer;
      timers.set(timer, callback);
      return timer;
    },
    clearTimeout: (timer) => {
      timers.delete(timer);
    },
  };
  class Script extends EventTarget {
    src = "";
    async = false;
    nonce = "";
    dataset: Record<string, string> = {};
    removed = false;
    remove() {
      this.removed = true;
    }
  }
  const scripts: Script[] = [];
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "window", { configurable: true, value: browser });
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      createElement: () => new Script(),
      querySelector: () => null,
      head: { appendChild: (script: Script) => scripts.push(script) },
    },
  });
  try {
    await run({ browser, scripts, timers, load });
  } finally {
    if (previousWindow) Object.defineProperty(globalThis, "window", previousWindow);
    else Reflect.deleteProperty(globalThis, "window");
    if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
}

test("auth failure before SDK readiness chains the prior callback and prevents remount retries", async () => {
  await freshPage("early-auth", async ({ browser, scripts, timers, load }) => {
    let previousCalls = 0;
    const previous = () => previousCalls++;
    browser.gm_authFailure = previous;
    const controller = new AbortController();
    let fallbacks = 0;
    const pending = load("invented-browser-key", controller.signal, () => {
      fallbacks++;
      controller.abort();
    });
    expect(scripts).toHaveLength(1);
    expect(timers.size).toBe(1);
    browser.gm_authFailure?.();
    await expect(pending).rejects.toThrow("authenticate");
    expect(fallbacks).toBe(1);
    expect(previousCalls).toBe(1);
    expect(scripts[0]?.removed).toBe(true);
    expect(browser.__tastipGoogleMapsReady).toBeUndefined();
    expect(timers.size).toBe(0);
    expect(browser.gm_authFailure).toBe(previous);
    await expect(load("invented-browser-key", new AbortController().signal)).rejects.toThrow(
      "authenticate",
    );
    expect(scripts).toHaveLength(1);
    expect(browser.gm_authFailure).toBe(previous);
  });
});

test("delayed auth failure notifies resolved mounted consumers and isolates an unmounted consumer", async () => {
  await freshPage("late-auth", async ({ browser, scripts, timers, load }) => {
    let previousCalls = 0;
    const previous = () => previousCalls++;
    browser.gm_authFailure = previous;
    const unmounted = new AbortController();
    const mounted = new AbortController();
    let unmountedFallbacks = 0;
    let mountedFallbacks = 0;
    const first = load("invented-browser-key", unmounted.signal, () => unmountedFallbacks++);
    const second = load("invented-browser-key", mounted.signal, () => {
      mountedFallbacks++;
      mounted.abort();
    });
    const library = { Map3DElement: class {} } as unknown as GoogleMaps3DLibrary;
    let imports = 0;
    browser.google = {
      maps: {
        importLibrary: async () => {
          imports++;
          return library;
        },
      },
    };
    browser.__tastipGoogleMapsReady?.();
    expect(await first).toBe(library);
    expect(await second).toBe(library);
    expect(timers.size).toBe(0);
    unmounted.abort();
    expect(browser.gm_authFailure).not.toBe(previous);
    browser.gm_authFailure?.();
    expect(unmountedFallbacks).toBe(0);
    expect(mountedFallbacks).toBe(1);
    expect(previousCalls).toBe(1);
    expect(browser.gm_authFailure).toBe(previous);
    await expect(load("invented-browser-key", new AbortController().signal)).rejects.toThrow(
      "authenticate",
    );
    expect(scripts).toHaveLength(1);
    expect(imports).toBe(1);
  });
});

test("explicit remount reuses only our partial SDK and cleanup preserves a later auth handler", async () => {
  await freshPage("partial-sdk", async ({ browser, scripts, timers, load }) => {
    const library = { Map3DElement: class {} } as unknown as GoogleMaps3DLibrary;
    let foreignImports = 0;
    const foreign = {
      importLibrary: async () => {
        foreignImports++;
        return library;
      },
    };
    browser.google = { maps: foreign };
    await expect(load("invented-browser-key", new AbortController().signal)).rejects.toThrow(
      "Another Google Maps loader",
    );
    expect(scripts).toHaveLength(0);
    expect(foreignImports).toBe(0);
    expect(browser.gm_authFailure).toBeUndefined();
    browser.google = undefined;
    let imports = 0;
    const own = {
      importLibrary: async () => {
        if (++imports === 1) throw new Error("Synthetic library interruption");
        return library;
      },
    };
    const interrupted = load("invented-browser-key", new AbortController().signal);
    browser.google = { maps: own };
    browser.__tastipGoogleMapsReady?.();
    await expect(interrupted).rejects.toThrow("could not load");
    expect(timers.size).toBe(0);
    expect(browser.gm_authFailure).toBeUndefined();
    browser.google = { maps: foreign };
    await expect(load("invented-browser-key", new AbortController().signal)).rejects.toThrow(
      "Another Google Maps loader",
    );
    expect(foreignImports).toBe(0);
    browser.google = { maps: own };
    const remount = new AbortController();
    expect(await load("invented-browser-key", remount.signal, () => {})).toBe(library);
    expect(imports).toBe(2);
    expect(scripts).toHaveLength(1);
    await expect(load("different-browser-key", new AbortController().signal)).rejects.toThrow(
      "already configured",
    );
    const laterOwner = () => {};
    browser.gm_authFailure = laterOwner;
    remount.abort();
    expect(browser.gm_authFailure).toBe(laterOwner);
    expect(await load("invented-browser-key", new AbortController().signal)).toBe(library);
    expect(browser.gm_authFailure).toBe(laterOwner);
    expect(imports).toBe(2);
  });
});
