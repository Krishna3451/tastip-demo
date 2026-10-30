"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  type AccountIdentity,
  AccountRequest,
  announceAccountChange,
  requestAccount,
  SESSION_CHANGE_KEY,
  SESSION_RECHECK_EVENT,
} from "./lib/account-request";

export type { AccountIdentity } from "./lib/account-request";

export function useAccount() {
  const [account, setAccountState] = useState<AccountIdentity | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AccountRequest | null>(null);
  const generation = useRef(0);
  const recovery = useRef<string | undefined>(undefined);
  const refresh = useCallback(async (hideWorkspace = true, recoveryMessage?: string) => {
    const run = ++generation.current;
    const notice = recoveryMessage ?? (hideWorkspace ? undefined : recovery.current);
    recovery.current = notice;
    request.current?.cancel();
    const operation = new AccountRequest();
    request.current = operation;
    if (hideWorkspace) {
      setReady(false);
      setAccountState(null);
    }
    try {
      const next = await requestAccount(operation);
      if (operation.signal.aborted || generation.current !== run) return;
      // A failed auth mutation stays fail-closed until the visible Retry action,
      // even after this automatic cookie reconciliation succeeds.
      setAccountState(notice ? null : next);
      setError(notice ?? null);
      setReady(!notice);
    } catch {
      if (generation.current === run) {
        setAccountState(null);
        setReady(false);
        setError("Your sign-in could not be checked. Retry to reopen your travel space.");
      }
    } finally {
      operation.dispose();
      if (request.current === operation) request.current = null;
    }
  }, []);
  const setAccount = useCallback((next: AccountIdentity | null) => {
    generation.current++;
    recovery.current = undefined;
    request.current?.cancel();
    setAccountState(next);
    setError(null);
    setReady(true);
    announceAccountChange();
  }, []);
  useEffect(() => {
    void refresh();
    const changed = (event: StorageEvent) => {
      if (event.key === SESSION_CHANGE_KEY || event.key === null) void refresh();
    };
    const recheck = (event: Event) => {
      const message =
        event instanceof CustomEvent && typeof event.detail === "string"
          ? event.detail.slice(0, 500)
          : undefined;
      void refresh(true, message);
    };
    const focused = () => {
      void refresh(false);
    };
    window.addEventListener("storage", changed);
    window.addEventListener("focus", focused);
    window.addEventListener(SESSION_RECHECK_EVENT, recheck);
    return () => {
      generation.current++;
      request.current?.cancel();
      window.removeEventListener("storage", changed);
      window.removeEventListener("focus", focused);
      window.removeEventListener(SESSION_RECHECK_EVENT, recheck);
    };
  }, [refresh]);
  return { account, ready, error, refresh, setAccount };
}
