export type AccountIdentity = { id: string; username: string };
export const ACCOUNT_REQUEST_TIMEOUT_MS = 15_000;
export const SESSION_CHANGE_KEY = "tastip.session.change.v1";
export const SESSION_RECHECK_EVENT = "tastip:session-recheck";

export class AccountTimeoutError extends Error {
  constructor() {
    super("Your account took too long to respond. Retry the sign-in check before trying again.");
    this.name = "AccountTimeoutError";
  }
}
export class AccountResponseError extends Error {}

export function isAccount(value: unknown): value is AccountIdentity {
  return Boolean(
    value &&
      typeof value === "object" &&
      "id" in value &&
      typeof value.id === "string" &&
      /^[a-f\d-]{36}$/i.test(value.id) &&
      "username" in value &&
      typeof value.username === "string" &&
      value.username.length > 0 &&
      value.username.length <= 32,
  );
}

/** A deadline covers headers, JSON parsing and guarded local handoff work.
 * wait also settles when a synthetic/third-party promise ignores AbortSignal. */
export class AccountRequest {
  readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout>;
  constructor(timeoutMs = ACCOUNT_REQUEST_TIMEOUT_MS) {
    this.timer = setTimeout(() => this.controller.abort(new AccountTimeoutError()), timeoutMs);
  }
  get signal() {
    return this.controller.signal;
  }
  cancel() {
    this.controller.abort(new DOMException("Account request cancelled", "AbortError"));
    this.dispose();
  }
  dispose() {
    clearTimeout(this.timer);
  }
  async wait<T>(work: Promise<T>): Promise<T> {
    const signal = this.signal;
    return new Promise<T>((resolve, reject) => {
      const cancelled = () => {
        signal.removeEventListener("abort", cancelled);
        reject(signal.reason);
      };
      work.then(
        (value) => {
          signal.removeEventListener("abort", cancelled);
          if (signal.aborted) reject(signal.reason);
          else resolve(value);
        },
        (error: unknown) => {
          signal.removeEventListener("abort", cancelled);
          reject(error);
        },
      );
      if (signal.aborted) cancelled();
      else signal.addEventListener("abort", cancelled, { once: true });
    });
  }
}

let mutation: AccountRequest | null = null;
/** One tab cannot run competing login/logout writes through different controls. */
export function beginAccountMutation() {
  if (mutation && !mutation.signal.aborted) return null;
  const request = new AccountRequest();
  mutation = request;
  request.signal.addEventListener("abort", () => finishAccountMutation(request), { once: true });
  return request;
}
export function finishAccountMutation(request: AccountRequest) {
  request.dispose();
  if (mutation === request) mutation = null;
}

export async function requestAccount(
  request: AccountRequest,
  action?: "login" | "register" | "logout",
  credentials?: { username: string; password: string },
): Promise<AccountIdentity | null> {
  const response = await request.wait(
    fetch("/api/account", {
      method: action ? "POST" : "GET",
      cache: "no-store",
      signal: request.signal,
      ...(action
        ? {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(action === "logout" ? { action } : { action, ...credentials }),
          }
        : {}),
    }),
  );
  const body: unknown = await request.wait(response.json());
  if (!response.ok) {
    const message =
      body &&
      typeof body === "object" &&
      "error" in body &&
      body.error &&
      typeof body.error === "object" &&
      "message" in body.error &&
      typeof body.error.message === "string"
        ? body.error.message
        : "Your account could not connect.";
    throw new AccountResponseError(message);
  }
  if (
    !body ||
    typeof body !== "object" ||
    !("account" in body) ||
    !(body.account === null || isAccount(body.account)) ||
    (action === "logout" ? body.account !== null : action && body.account === null)
  )
    throw new Error(
      "Your sign-in response could not be verified. Check your sign-in before retrying.",
    );
  return body.account;
}

/** No identity/token in the broadcast. An aborted POST may already have changed its cookie. */
export function announceAccountChange(recheckThisTab = false, recoveryMessage?: string) {
  try {
    localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID());
  } catch {
    /* Focus rechecks remain available. */
  }
  if (recheckThisTab)
    window.dispatchEvent(new CustomEvent(SESSION_RECHECK_EVENT, { detail: recoveryMessage }));
}

export type AccountHandoff = { signal: AbortSignal; isCurrent: () => boolean };
