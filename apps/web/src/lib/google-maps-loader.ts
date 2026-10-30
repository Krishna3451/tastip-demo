// The small interface below follows Google's Maps JavaScript 3D reference.
// https://developers.google.com/maps/documentation/javascript/reference/3d-map
export type GoogleCamera = {
  center: { lat: number; lng: number; altitude: number };
  range: number;
  tilt: number;
  heading: number;
};

export type GoogleMap3D = HTMLElement &
  GoogleCamera & {
    description: string;
    flyCameraTo: (options: { endCamera: GoogleCamera; durationMillis: number }) => void;
    stopCameraAnimation: () => void;
  };

type GoogleMapOptions = GoogleCamera & {
  mode: "SATELLITE";
  gestureHandling: "GREEDY";
  defaultUIHidden: boolean;
  description: string;
  fov: number;
};

export type GoogleMaps3DLibrary = {
  Map3DElement: new (options: GoogleMapOptions) => GoogleMap3D;
};

type MapsWindow = Window & {
  google?: { maps?: { importLibrary: (name: "maps3d") => Promise<GoogleMaps3DLibrary> } };
  __tastipGoogleMapsReady?: () => void;
  gm_authFailure?: () => void;
};

let request: { key: string; promise: Promise<GoogleMaps3DLibrary> } | null = null;
let ownedMaps: {
  key: string;
  maps: NonNullable<NonNullable<MapsWindow["google"]>["maps"]>;
} | null = null;
let authenticationError: Error | null = null;
let authBridge: {
  consumers: Set<() => void>;
  release: () => void;
} | null = null;

function listenForAuthenticationFailure(consumer: () => void) {
  if (!authBridge) {
    const mapsWindow = window as MapsWindow;
    const previous = mapsWindow.gm_authFailure;
    const consumers = new Set<() => void>();
    const handler = () => {
      authenticationError ??= new Error("Google Maps could not authenticate. Reload to retry.");
      request = null;
      try {
        for (const notify of [...consumers]) notify();
      } finally {
        previous?.call(mapsWindow);
      }
    };
    authBridge = {
      consumers,
      release: () => {
        // Do not overwrite a handler installed by another owner after ours.
        if (mapsWindow.gm_authFailure !== handler) return;
        if (previous) mapsWindow.gm_authFailure = previous;
        else delete mapsWindow.gm_authFailure;
      },
    };
    mapsWindow.gm_authFailure = handler;
  }
  const bridge = authBridge;
  bridge.consumers.add(consumer);
  return () => {
    bridge.consumers.delete(consumer);
    if (bridge.consumers.size || authBridge !== bridge) return;
    bridge.release();
    authBridge = null;
  };
}

/** One SDK per page. A mounted map owns its DOM; the shared SDK survives navigation. */
function sharedLibrary(key: string) {
  if (request) return request.promise;
  const mapsWindow = window as MapsWindow;
  const currentMaps = mapsWindow.google?.maps;
  // Only the namespace captured by our SDK callback may survive a failed import.
  if (currentMaps && currentMaps !== ownedMaps?.maps)
    return Promise.reject(new Error("Another Google Maps loader is already present."));
  const promise = new Promise<GoogleMaps3DLibrary>((resolve, reject) => {
    let script: HTMLScriptElement | undefined;
    let settled = false;
    const cleanup = () => {
      window.clearTimeout(timer);
      script?.removeEventListener("error", fail);
      if (mapsWindow.__tastipGoogleMapsReady === ready) delete mapsWindow.__tastipGoogleMapsReady;
      stopAuthenticationListener();
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      cleanup();
      script?.remove();
      reject(authenticationError ?? new Error("Google Maps could not load."));
    };
    const ready = () => {
      if (settled) return;
      const maps = mapsWindow.google?.maps;
      if (!maps) {
        fail();
        return;
      }
      ownedMaps = { key, maps };
      Promise.resolve()
        .then(() => maps.importLibrary("maps3d"))
        .then((library) => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(library);
        }, fail);
    };
    const timer = window.setTimeout(fail, 15_000);
    const stopAuthenticationListener = listenForAuthenticationFailure(fail);
    if (currentMaps) {
      ready();
      return;
    }
    script = document.createElement("script");
    const params = new URLSearchParams({
      key,
      v: "weekly",
      loading: "async",
      libraries: "maps3d",
      callback: "__tastipGoogleMapsReady",
    });
    script.src = `https://maps.googleapis.com/maps/api/js?${params}`;
    script.async = true;
    script.dataset.tastipGoogleMaps = "true";
    script.nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";
    mapsWindow.__tastipGoogleMapsReady = ready;
    script.addEventListener("error", fail, { once: true });
    document.head.appendChild(script);
  });
  const currentRequest = { key, promise };
  request = currentRequest;
  void promise.catch(() => {
    if (request === currentRequest) request = null;
  });
  return promise;
}

/** Auth errors remain observable after importLibrary resolves, until this consumer aborts. */
export function loadGoogleMaps3D(
  key: string,
  signal: AbortSignal,
  onAuthenticationFailure?: () => void,
) {
  if (!key.trim()) return Promise.reject(new Error("A Google Maps browser key is required."));
  if (signal.aborted) return Promise.reject(signal.reason);
  if ((request && request.key !== key) || (ownedMaps && ownedMaps.key !== key))
    return Promise.reject(new Error("Google Maps is already configured for this page."));
  // Google has already rejected this page. Remounting must not start a retry loop.
  if (authenticationError) return Promise.reject(authenticationError);

  // Cancelling a consumer removes its listener without invalidating another map's SDK.
  return new Promise<GoogleMaps3DLibrary>((resolve, reject) => {
    let active = true;
    const cleanup = () => {
      active = false;
      signal.removeEventListener("abort", abort);
      stopAuthenticationListener();
    };
    const abort = () => {
      cleanup();
      reject(signal.reason);
    };
    const stopAuthenticationListener = listenForAuthenticationFailure(() => {
      if (!active) return;
      cleanup();
      reject(authenticationError);
      onAuthenticationFailure?.();
    });
    signal.addEventListener("abort", abort, { once: true });
    sharedLibrary(key).then(
      (library) => {
        if (!onAuthenticationFailure) cleanup();
        if (!signal.aborted) resolve(library);
      },
      (error: unknown) => {
        cleanup();
        if (!signal.aborted) reject(error);
      },
    );
  });
}
