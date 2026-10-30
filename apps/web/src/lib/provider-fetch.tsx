"use client";

import { createContext, type ReactNode, useCallback, useContext } from "react";

type Access = { accountId: string | null; ready: boolean };
export type ProviderFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
const AccessContext = createContext<Access>({ accountId: null, ready: false });
const paths = new Set([
  "/api/chat",
  "/api/taste",
  "/api/taste/search",
  "/api/voice/session",
  "/api/routes",
  "/api/health",
  "/api/maps/config",
]);

export function ProviderAccess({ accountId, ready, children }: Access & { children: ReactNode }) {
  return <AccessContext.Provider value={{ accountId, ready }}>{children}</AccessContext.Provider>;
}

/** Clone headers and replace any supplied identity with the owner of this rendered caller. */
export function providerRequestHeaders(accountId: string | null, initialHeaders?: HeadersInit) {
  const headers = new Headers(initialHeaders);
  headers.delete("X-Tastip-Account");
  if (accountId !== null) headers.set("X-Tastip-Account", accountId);
  return headers;
}

/** Injectable transport also lets tests verify stale rendered callers without a live provider. */
export function createProviderFetch(
  { accountId, ready }: Access,
  transport: ProviderFetch = fetch,
  origin?: string,
): ProviderFetch {
  return async (input, init) => {
    if (!ready)
      throw new Error(
        "Your sign-in is still being checked. Reopen the app before using live integrations.",
      );
    const appOrigin = origin ?? (typeof window !== "undefined" ? window.location.origin : null);
    if (!appOrigin) throw new Error("Provider requests must come from the Tastip app.");
    const request = input instanceof Request ? input : null;
    const url = new URL(request?.url ?? String(input), `${appOrigin}/`);
    if (url.origin !== appOrigin || url.username || url.password || !paths.has(url.pathname))
      throw new Error("Only Tastip’s own provider API paths can use this request helper.");
    return transport(input, {
      ...init,
      headers: providerRequestHeaders(accountId, init?.headers ?? request?.headers),
      credentials: "same-origin",
      mode: "same-origin",
      // Never forward a rendered account identity to a redirected destination.
      redirect: "error",
    });
  };
}

export function useProviderFetch(): ProviderFetch {
  const { accountId, ready } = useContext(AccessContext);
  return useCallback(
    (input, init) => createProviderFetch({ accountId, ready })(input, init),
    [accountId, ready],
  );
}
