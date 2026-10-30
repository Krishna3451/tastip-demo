"use client";

import { parseTasteProfile, type TasteProfile } from "@tastip/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AccountIdentity } from "./use-account";

type SavedProfile = { profile: TasteProfile | null; revision: number };
function parseSavedProfile(value: unknown): SavedProfile {
  if (
    !value ||
    typeof value !== "object" ||
    !("profile" in value) ||
    !("revision" in value) ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0
  )
    throw new Error("Saved preferences could not be checked. Reload them to try again.");
  const profile = value.profile === null ? null : parseTasteProfile(value.profile);
  if (value.profile !== null && !profile)
    throw new Error("Saved preferences could not be validated.");
  return { profile, revision: value.revision as number };
}

/** Each mount reads only the visible account; stale responses cannot cross a sign-in change. */
export function useTasteProfile(account: AccountIdentity | null) {
  const owner = account?.id ?? null;
  const [state, setState] = useState<SavedProfile & { owner: string | null; ready: boolean }>({
    owner: null,
    profile: null,
    revision: 0,
    ready: false,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const perform = useCallback(
    async (write?: { profile: TasteProfile | null; expectedRevision: number }) => {
      if (!owner || (write && inFlight.current)) return false;
      const run = ++generation.current;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      inFlight.current = true;
      setBusy(true);
      setError(null);
      try {
        const response = await fetch("/api/profile", {
          method: write ? "POST" : "GET",
          cache: "no-store",
          headers: {
            "X-Tastip-Account": owner,
            ...(write ? { "Content-Type": "application/json" } : {}),
          },
          ...(write
            ? {
                body: JSON.stringify({
                  action: write.profile ? "save" : "forget",
                  profile: write.profile,
                  expectedRevision: write.expectedRevision,
                }),
              }
            : {}),
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "Saved preferences could not connect.");
        const saved = parseSavedProfile(body);
        if (controller.signal.aborted || generation.current !== run) return false;
        setState({ owner, ...saved, ready: true });
        return true;
      } catch (cause) {
        if (!controller.signal.aborted && generation.current === run) {
          setState({ owner, profile: null, revision: 0, ready: false });
          setError(cause instanceof Error ? cause.message : "Saved preferences could not connect.");
        }
        return false;
      } finally {
        if (generation.current === run) {
          inFlight.current = false;
          setBusy(false);
        }
      }
    },
    [owner],
  );
  useEffect(() => {
    setState({ owner, profile: null, revision: 0, ready: false });
    setError(null);
    if (owner) void perform();
    return () => {
      generation.current++;
      request.current?.abort();
      inFlight.current = false;
    };
  }, [owner, perform]);
  const ready = state.owner === owner && state.ready;
  return {
    profile: ready ? state.profile : null,
    ready,
    busy,
    error,
    reload: () => perform(),
    save: (profile: TasteProfile | null) =>
      ready ? perform({ profile, expectedRevision: state.revision }) : Promise.resolve(false),
  };
}
