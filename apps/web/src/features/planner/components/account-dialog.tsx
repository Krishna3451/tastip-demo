"use client";

import type { TasteProfile } from "@tastip/domain";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AccountHandoff,
  type AccountRequest,
  AccountResponseError,
  announceAccountChange,
  beginAccountMutation,
  finishAccountMutation,
  requestAccount,
  SESSION_CHANGE_KEY,
  SESSION_RECHECK_EVENT,
} from "../lib/account-request";
import type { AccountIdentity } from "../use-account";
import { TasteProfileCard } from "./taste-profile-card";
export function AccountDialog({
  account,
  hasDraft,
  currentProfile,
  onAuthenticated,
  onSignedOut,
  onClose,
}: {
  account: AccountIdentity | null;
  hasDraft: boolean;
  currentProfile?: TasteProfile;
  onAuthenticated: (
    account: AccountIdentity,
    keepDraft: boolean,
    handoff: AccountHandoff,
  ) => void | Promise<void>;
  onSignedOut: () => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const owner = account?.id ?? null;
  const ownerRef = useRef(owner);
  ownerRef.current = owner;
  const alive = useRef(false);
  const operation = useRef<{
    request: AccountRequest;
    owner: string | null;
    committing?: string | null;
  } | null>(null);
  const [mode, setMode] = useState<"login" | "register">("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [keepDraft, setKeepDraft] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    alive.current = true;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      alive.current = false;
      const pending = operation.current;
      operation.current = null;
      if (pending) {
        pending.request.cancel();
        finishAccountMutation(pending.request);
        announceAccountChange(true);
      }
      document.body.style.overflow = overflow;
      requestAnimationFrame(() => previous?.focus());
    };
  }, []);
  const cancelPending = useCallback((reconcile = true) => {
    const pending = operation.current;
    operation.current = null;
    if (!pending) return;
    pending.request.cancel();
    finishAccountMutation(pending.request);
    setPending(false);
    if (reconcile) announceAccountChange(true);
  }, []);
  useEffect(() => {
    const current = operation.current;
    if (current && owner !== current.owner && owner !== current.committing) {
      cancelPending();
      setError("Your sign-in changed. Check the current account before trying again.");
    }
  }, [owner, cancelPending]);
  useEffect(() => {
    const invalidate = () => {
      if (!operation.current) return;
      cancelPending(false);
      setError("Your sign-in changed. Check the current account before trying again.");
    };
    const changed = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGE_KEY || event.key === null) invalidate();
    };
    window.addEventListener("storage", changed);
    window.addEventListener(SESSION_RECHECK_EVENT, invalidate);
    return () => {
      window.removeEventListener("storage", changed);
      window.removeEventListener(SESSION_RECHECK_EVENT, invalidate);
    };
  }, [cancelPending]);
  function close() {
    cancelPending();
    onClose();
  }
  async function submit(action: "login" | "register" | "logout") {
    if (operation.current) return;
    const request = beginAccountMutation();
    if (!request) {
      setError("Another account request is running. Wait for it to finish or try again shortly.");
      return;
    }
    const current = {
      request,
      owner: ownerRef.current,
      committing: undefined as string | null | undefined,
    };
    operation.current = current;
    const isCurrent = () =>
      alive.current &&
      operation.current === current &&
      !request.signal.aborted &&
      (ownerRef.current === current.owner || ownerRef.current === current.committing);
    // These choices stay frozen until the request settles or is cancelled.
    const retainDraft = keepDraft;
    setPending(true);
    setError(null);
    try {
      const next = await requestAccount(request, action, { username, password });
      if (!isCurrent()) {
        if (operation.current === current) cancelPending();
        return;
      }
      setPassword("");
      current.committing = next?.id ?? null;
      if (action === "logout") onSignedOut();
      else if (next)
        await request.wait(
          Promise.resolve(
            onAuthenticated(next, retainDraft, { signal: request.signal, isCurrent }),
          ),
        );
      if (isCurrent()) {
        operation.current = null;
        finishAccountMutation(request);
        onClose();
      } else if (operation.current === current) cancelPending();
    } catch (cause) {
      if (!alive.current || operation.current !== current) return;
      operation.current = null;
      request.cancel();
      finishAccountMutation(request);
      setError(cause instanceof Error ? cause.message : "Your account could not connect.");
      // Headers/cookies can have arrived even if the response body or local handoff stalled.
      if (!(cause instanceof AccountResponseError))
        announceAccountChange(
          true,
          cause instanceof Error
            ? cause.message
            : "Your account could not connect. Retry the sign-in check.",
        );
    } finally {
      finishAccountMutation(request);
      if (alive.current && (!operation.current || operation.current === current)) {
        operation.current = null;
        setPending(false);
      }
    }
  }
  return (
    <dialog
      ref={dialog}
      className="account-dialog"
      aria-label="Tastip account"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <span className="eyebrow">YOUR TRAVEL SPACE</span>
        <button type="button" className="icon-button" aria-label="Close account" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {account ? (
        <>
          <h2>A world to come back to.</h2>
          <p>
            Signed in as <strong>{account.username}</strong>.
          </p>
          <p>
            Your server-saved trips stay with this account. On sign-out, cached account drafts are
            removed from this browser. Save or download any unsaved changes first.
          </p>
          <TasteProfileCard account={account} currentProfile={currentProfile} />
          <button
            type="button"
            className="button button-secondary"
            disabled={pending}
            onClick={() => void submit("logout")}
          >
            {pending ? "Signing out…" : "Sign out"}
          </button>
        </>
      ) : (
        <>
          <h2>{mode === "login" ? "Welcome back." : "Keep your journeys close."}</h2>
          <p>
            Save trips to your account on this Tastip server and create read-only links when you
            choose to share.
          </p>
          <div className="account-mode">
            <button
              type="button"
              aria-pressed={mode === "login"}
              disabled={pending}
              onClick={() => setMode("login")}
            >
              Sign in
            </button>
            <button
              type="button"
              aria-pressed={mode === "register"}
              disabled={pending}
              onClick={() => setMode("register")}
            >
              Create account
            </button>
          </div>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit(mode);
            }}
          >
            <label>
              Username
              <input
                aria-label="Account username"
                disabled={pending}
                autoComplete="username"
                required
                minLength={3}
                maxLength={32}
                pattern="[a-zA-Z0-9][a-zA-Z0-9._-]{2,31}"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              Password
              <input
                aria-label="Account password"
                disabled={pending}
                type="password"
                autoComplete={mode === "register" ? "new-password" : "current-password"}
                required
                minLength={10}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {hasDraft && (
              <label className="account-keep-draft">
                <input
                  type="checkbox"
                  disabled={pending}
                  checked={keepDraft}
                  onChange={(event) => setKeepDraft(event.target.checked)}
                />
                Keep my current draft in this account’s browser workspace
              </label>
            )}
            <button type="submit" className="button button-primary" disabled={pending}>
              {pending
                ? "Opening your space…"
                : mode === "register"
                  ? "Create my account"
                  : "Sign in to Tastip"}
            </button>
          </form>
          {mode === "register" && (
            <small>
              Choose a password unique to this prototype. Email verification and account recovery
              are not available yet.
            </small>
          )}
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </dialog>
  );
}
