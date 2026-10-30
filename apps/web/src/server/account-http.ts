import { localIntegrationEnabled } from "./http";
import { ServiceError } from "./service-error";
import { type Account, getTripStore } from "./trip-store";

const COOKIE = "tastip_session";
export function sessionToken(request: Request) {
  const matches =
    request.headers
      .get("cookie")
      ?.split(";")
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${COOKIE}=`)) ?? [];
  // Duplicate cookies can be ambiguous across paths; fail closed instead of choosing one.
  if (matches.length !== 1) return undefined;
  const token = matches[0]?.slice(COOKIE.length + 1);
  return token && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : undefined;
}
export function requestAccount(request: Request): Account | null {
  const token = sessionToken(request);
  return token ? getTripStore().account(token) : null;
}
export function assertAccountIdentity(request: Request, account: Account) {
  if (request.headers.get("X-Tastip-Account") !== account.id)
    throw new ServiceError(
      "ACCOUNT_CHANGED",
      "Your sign-in changed in another tab. Refresh before continuing in this workspace.",
      409,
    );
  return account;
}
export function requireAccount(request: Request) {
  const account = requestAccount(request);
  if (!account)
    throw new ServiceError("SIGN_IN_REQUIRED", "Sign in to save trips to this server.", 401);
  return assertAccountIdentity(request, account);
}
export function setSessionCookie(
  response: Response,
  token: string,
  request: Request,
  remove = false,
) {
  if (!remove && !/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new ServiceError("INVALID_SESSION", "The sign-in session could not be created.", 500);
  const secure =
    process.env.NODE_ENV === "production" || new URL(request.url).protocol === "https:";
  response.headers.append(
    "Set-Cookie",
    `${COOKIE}=${remove ? "" : token}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${remove ? 0 : 604800}${secure ? "; Secure" : ""}`,
  );
  return response;
}
function configuredInternalOrigin() {
  const value = process.env.TASTIP_INTERNAL_ORIGIN;
  if (!value) return null;
  try {
    const origin = new URL(value);
    return ["http:", "https:"].includes(origin.protocol) &&
      origin.origin === value &&
      ["localhost", "127.0.0.1", "[::1]", "0.0.0.0", "[::]"].includes(origin.hostname)
      ? origin.origin
      : null;
  } catch {
    return null;
  }
}
function hostedOriginMatches(request: Request) {
  if (process.env.TASTIP_ENABLE_HOSTED_PROVIDERS !== "1" || !process.env.TASTIP_APP_ORIGIN)
    return false;
  try {
    const configured = new URL(process.env.TASTIP_APP_ORIGIN);
    const incoming = new URL(request.url);
    if (configured.protocol !== "https:" || configured.origin !== process.env.TASTIP_APP_ORIGIN)
      return false;
    // Self-hosted Next can normalize Request.url to the internal loopback HTTP origin.
    // A forwarded host/protocol header is never authority to turn on a paid endpoint.
    const canonicalUrl = incoming.origin === configured.origin;
    const internalUrl =
      incoming.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname);
    // A deployment may explicitly name Next's wildcard bind URL after trusted proxy
    // normalization. This never trusts request-supplied forwarding headers.
    const configuredInternalUrl = incoming.origin === configuredInternalOrigin();
    if (!canonicalUrl && !internalUrl && !configuredInternalUrl) return false;
    const fetchSite = request.headers.get("Sec-Fetch-Site");
    if (fetchSite && fetchSite !== "same-origin") return false;
    const origin = request.headers.get("Origin");
    if (origin !== null) return origin === configured.origin;
    if (!["GET", "HEAD"].includes(request.method)) return false;
    const referer = request.headers.get("Referer");
    return referer !== null && new URL(referer).origin === configured.origin;
  } catch {
    return false;
  }
}
/** Hosted calls remain opt-in and require the exact configured HTTPS application origin. */
export function providerAvailable(request: Request) {
  const local = localIntegrationEnabled(request);
  if (!local && !hostedOriginMatches(request)) return false;
  const account = requestAccount(request);
  if (account) return request.headers.get("X-Tastip-Account") === account.id;
  return local && !request.headers.has("X-Tastip-Account");
}
/** Guest guidance reflects deployment/authentication policy, never provider key presence. */
export function providerRequiresSignIn(request: Request) {
  return (
    !localIntegrationEnabled(request) && hostedOriginMatches(request) && !requestAccount(request)
  );
}
function configuredLimit(name: string, fallback: number) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new ServiceError(
      "INVALID_QUOTA",
      "Provider request limits are not configured correctly.",
      500,
    );
  return parsed;
}
export function assertProviderAccess(request: Request) {
  const local = localIntegrationEnabled(request);
  if (!local && !hostedOriginMatches(request))
    throw new ServiceError(
      "LOCAL_INTEGRATION_ONLY",
      "Live integrations require local development or an authenticated, configured deployment.",
      403,
    );
  const account = requestAccount(request);
  if (!local && !account)
    throw new ServiceError(
      "SIGN_IN_REQUIRED",
      "Sign in to use live integrations on this deployment.",
      403,
    );
  if (account) assertAccountIdentity(request, account);
  else if (request.headers.has("X-Tastip-Account"))
    throw new ServiceError(
      "ACCOUNT_CHANGED",
      "Your sign-in changed. Refresh before using live integrations.",
      409,
    );
  const dailyLimit = configuredLimit("TASTIP_DAILY_PROVIDER_LIMIT", 100);
  const globalLimit = configuredLimit("TASTIP_GLOBAL_PROVIDER_LIMIT", 1000);
  const store = getTripStore();
  const owner = account?.id ?? "local-development";
  store.consume(`provider:minute:${owner}`, 30, 60000);
  store.consume(`provider:day:${owner}`, dailyLimit, 86400000);
  store.consume("provider:global:day", globalLimit, 86400000);
}
