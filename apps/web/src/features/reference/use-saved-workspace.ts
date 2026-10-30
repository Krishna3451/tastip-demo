"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { parseSavedPlaces } from "../planner/lib/saved-places";
import {
  EMPTY_SAVED_WORKSPACE,
  parseSavedWorkspace,
  type SavedWorkspace,
} from "../planner/lib/saved-workspace";

type Snapshot = { workspace: SavedWorkspace; revision: number };
type State = Snapshot & {
  key: string;
  ready: boolean;
  busy: boolean;
  dirty: boolean;
  error: string;
  remote?: Snapshot;
  device?: SavedWorkspace;
  blockedDraft?: boolean;
};
const initial = (): State => ({
  key: "",
  workspace: structuredClone(EMPTY_SAVED_WORKSPACE),
  revision: 0,
  ready: false,
  busy: false,
  dirty: false,
  error: "",
});
const same = (a: SavedWorkspace, b: SavedWorkspace) => JSON.stringify(a) === JSON.stringify(b);
function hasItems(workspace: SavedWorkspace) {
  return workspace.places.length + workspace.collections.length > 0;
}
function snapshot(body: unknown): Snapshot {
  if (!body || typeof body !== "object") throw new Error("Your account saves could not be read.");
  const value = body as { workspace?: unknown; revision?: number };
  const workspace =
    value.workspace === null
      ? structuredClone(EMPTY_SAVED_WORKSPACE)
      : parseSavedWorkspace(value.workspace);
  if (!workspace || !Number.isSafeInteger(value.revision) || (value.revision ?? -1) < 0)
    throw new Error("Your account saves could not be checked. The stored copy has been kept.");
  return { workspace, revision: value.revision as number };
}
function draftSnapshot(raw: string): Snapshot {
  const value = JSON.parse(raw);
  if (!value || !parseSavedWorkspace(value.workspace))
    throw new Error("This unsynced device copy could not be read.");
  return snapshot(value);
}
export function combineSaved(account: SavedWorkspace, device: SavedWorkspace): SavedWorkspace {
  const places = [
    ...account.places,
    ...device.places.filter(
      (item) => !account.places.some((other) => other.place.id === item.place.id),
    ),
  ];
  const collections = [
    ...account.collections.map((item) => {
      const local = device.collections.find((other) => other.id === item.id);
      return local
        ? {
            ...item,
            placeIds: [...new Set([...item.placeIds, ...local.placeIds])],
            ...(item.placeNotes || local.placeNotes
              ? { placeNotes: { ...local.placeNotes, ...item.placeNotes } }
              : {}),
          }
        : item;
    }),
    ...device.collections.filter(
      (item) => !account.collections.some((other) => other.id === item.id),
    ),
  ];
  const merged = parseSavedWorkspace({ places, collections });
  if (!merged)
    throw new Error(
      "Both copies exceed the Saved limits. Your account and device copies have been kept.",
    );
  return merged;
}
export function useSavedWorkspace(accountId: string | null, identityReady: boolean) {
  const key = accountId ?? "guest";
  const [state, setState] = useState<State>(initial);
  const current = useRef(state);
  const scope = useRef(key);
  scope.current = key;
  const identityIsReady = useRef(identityReady);
  identityIsReady.current = identityReady;
  const generation = useRef(0);
  const request = useRef<AbortController | null>(null);
  const draftSeen = useRef<string | null>(null);
  const canonical = `tastip.reference.saved-workspace:${key}`;
  const draftKey = `tastip.reference.saved-draft:${key}`;
  const originKey = `tastip.reference.saved-origin:${key}`;
  const recoveryKey = `tastip.reference.saved-recovery:${key}`;
  const placesKey = `tastip.reference.saved:${key}`;
  const collectionsKey = `tastip.reference.collections:${key}`;
  const put = useCallback((next: State) => {
    current.current = next;
    setState(next);
  }, []);
  const alive = (run: number, controller: AbortController) =>
    scope.current === key &&
    identityIsReady.current &&
    generation.current === run &&
    !controller.signal.aborted;
  function preserveRaw(backupKey: string, raw: string) {
    const existing = localStorage.getItem(backupKey);
    if (existing !== null && existing !== raw)
      throw new Error("An earlier unreadable copy is still preserved. This copy was not replaced.");
    if (existing === null) localStorage.setItem(backupKey, raw);
  }
  function workspaceFrom(raw: string) {
    const value = parseSavedWorkspace(JSON.parse(raw));
    if (!value) throw new Error("The saved copy could not be checked.");
    return value;
  }
  function preserveRecovery(workspace: SavedWorkspace) {
    const prior = localStorage.getItem(recoveryKey);
    if (prior !== null) {
      try {
        workspaceFrom(prior);
      } catch {
        preserveRaw(`${recoveryKey}:unreadable`, prior);
      }
    }
    localStorage.setItem(recoveryKey, JSON.stringify(workspace));
  }
  function mirror(workspace: SavedWorkspace) {
    // Check compatibility caches on every write, even after an origin copy exists.
    const prior = parseSavedWorkspace({
      places: JSON.parse(localStorage.getItem(placesKey) ?? "[]"),
      collections: JSON.parse(localStorage.getItem(collectionsKey) ?? "[]"),
    });
    if (!prior) return;
    if (accountId && localStorage.getItem(originKey) === null)
      localStorage.setItem(originKey, JSON.stringify(prior));
    localStorage.setItem(placesKey, JSON.stringify(workspace.places));
    localStorage.setItem(collectionsKey, JSON.stringify(workspace.collections));
  }
  function checkDraft(expected: string | null, remote?: Snapshot) {
    const raw = localStorage.getItem(draftKey);
    if (raw === expected || raw === null) return true;
    const value = current.current;
    let pending: Snapshot | undefined;
    try {
      pending = draftSnapshot(raw);
    } catch {
      // An unknown copy must be explicitly preserved before replacing it.
    }
    if (value.dirty) preserveRecovery(value.workspace);
    draftSeen.current = raw;
    put({
      ...value,
      ...(pending ?? remote),
      busy: false,
      ready: Boolean(pending),
      dirty: Boolean(pending),
      blockedDraft: !pending,
      remote,
      error: pending
        ? "Another tab has unsynced saves. Review the account copy before making more changes."
        : "Another tab's unsynced copy could not be read. Review account saves to preserve it before continuing.",
    });
    return false;
  }
  function writeDraft(value: Snapshot) {
    if (!checkDraft(draftSeen.current)) return false;
    const raw = JSON.stringify(value);
    localStorage.setItem(draftKey, raw);
    draftSeen.current = raw;
    return true;
  }
  function removeDraft(expected: string | null, remote: Snapshot) {
    if (!checkDraft(expected, remote)) return false;
    // This operation owns only these exact bytes; a different tab's copy survives.
    if (localStorage.getItem(draftKey) === expected) localStorage.removeItem(draftKey);
    draftSeen.current = null;
    return true;
  }
  async function responseValue(response: Response) {
    const body = await response.json();
    if (!response.ok)
      throw new Error(body.error?.message ?? "Your account saves could not connect. Try again.");
    return snapshot(body);
  }
  function cache(value: Snapshot) {
    const prior = localStorage.getItem(canonical);
    if (prior !== null) {
      try {
        workspaceFrom(prior);
      } catch {
        preserveRaw(`${recoveryKey}:unreadable-workspace`, prior);
      }
    }
    localStorage.setItem(canonical, JSON.stringify(value.workspace));
    localStorage.setItem(`${canonical}:revision`, String(value.revision));
  }
  async function upload(workspace: SavedWorkspace, revision: number, run = generation.current) {
    if (!accountId || scope.current !== key || !identityIsReady.current) return;
    try {
      if (!writeDraft({ workspace, revision })) return;
    } catch {
      put({
        ...current.current,
        busy: false,
        dirty: true,
        error: "Your device copy could not be preserved. Nothing was sent.",
      });
      return;
    }
    const expectedDraft = draftSeen.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    put({
      ...current.current,
      workspace,
      revision,
      busy: true,
      dirty: true,
      error: "",
      remote: undefined,
    });
    try {
      const response = await fetch("/api/saved", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tastip-Account": accountId },
        body: JSON.stringify({ action: "save", workspace, expectedRevision: revision }),
        signal: controller.signal,
      });
      const accepted = await responseValue(response);
      if (!alive(run, controller)) return;
      if (accepted.revision <= revision || !same(accepted.workspace, workspace))
        throw new Error(
          "The account reply did not match this save. Your device copy has been kept.",
        );
      // Server acceptance is authoritative; failure to cache it does not repeat the write.
      let warning = "";
      try {
        cache(accepted);
        if (!removeDraft(expectedDraft, accepted)) return;
        mirror(accepted.workspace);
      } catch {
        warning = "Saved to your account. This browser could not update its local cache.";
      }
      put({
        ...current.current,
        ...accepted,
        ready: true,
        busy: false,
        dirty: false,
        error: warning,
        remote: undefined,
      });
    } catch (cause) {
      if (alive(run, controller))
        put({
          ...current.current,
          busy: false,
          dirty: true,
          error:
            cause instanceof Error
              ? cause.message
              : "Your saves could not sync. Your device copy has been kept.",
        });
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: All storage paths and request ownership are tied to this identity.
  useEffect(() => {
    if (!identityReady) return;
    const run = ++generation.current;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    draftSeen.current = null;
    let local = structuredClone(EMPTY_SAVED_WORKSPACE);
    let localError = "";
    let pending: Snapshot | undefined;
    let blockedDraft = false;
    let device: SavedWorkspace | undefined;
    const warning = () => {
      localError = "Some device saves could not be read. Their stored copies have been kept.";
    };
    // Each copy is independent: an unreadable legacy cache must not hide a pending edit.
    try {
      const places = parseSavedPlaces(localStorage.getItem(placesKey) ?? "[]");
      const legacy =
        places &&
        parseSavedWorkspace({
          places,
          collections: JSON.parse(localStorage.getItem(collectionsKey) ?? "[]"),
        });
      if (!legacy) throw new Error("Unreadable legacy saves");
      local = legacy;
      if (accountId) device = legacy;
    } catch {
      warning();
    }
    try {
      const stored = localStorage.getItem(canonical);
      if (stored !== null) local = workspaceFrom(stored);
    } catch {
      warning();
    }
    if (accountId) {
      for (const copyKey of [originKey, recoveryKey]) {
        try {
          const raw = localStorage.getItem(copyKey);
          if (raw !== null) device = workspaceFrom(raw);
        } catch {
          warning();
        }
      }
      try {
        const draft = localStorage.getItem(draftKey);
        draftSeen.current = draft;
        if (draft !== null) pending = draftSnapshot(draft);
      } catch {
        blockedDraft = true;
        localError =
          "An unsynced device copy could not be read. Review account saves before making changes; its original bytes will be preserved.";
      }
    }
    const loadedDraft = draftSeen.current;
    put({
      ...initial(),
      key,
      workspace: pending?.workspace ?? local,
      revision: pending?.revision ?? 0,
      dirty: Boolean(pending),
      ready: !accountId && !localError,
      busy: Boolean(accountId),
      error: localError,
      device,
      blockedDraft,
    });
    if (accountId)
      void (async () => {
        try {
          const remote = await responseValue(
            await fetch("/api/saved", {
              headers: { "X-Tastip-Account": accountId },
              cache: "no-store",
              signal: controller.signal,
            }),
          );
          if (!alive(run, controller)) return;
          if (!checkDraft(loadedDraft, remote)) return;
          if (blockedDraft) {
            put({
              key,
              ...remote,
              ready: false,
              busy: false,
              dirty: false,
              error: localError,
              remote,
              device,
              blockedDraft: true,
            });
          } else if (pending && !same(pending.workspace, remote.workspace)) {
            put({
              key,
              ...pending,
              ready: true,
              busy: false,
              dirty: true,
              error:
                "This device has unsynced saves. Review the account copy or retry before making more changes.",
              remote,
              device,
            });
          } else if (remote.revision === 0 && !localError && hasItems(local)) {
            if (!writeDraft({ workspace: local, revision: 0 })) return;
            put({
              key,
              workspace: local,
              revision: 0,
              ready: true,
              busy: false,
              dirty: true,
              error: "",
              device,
            });
            await upload(local, 0, run);
          } else {
            let warning = localError;
            try {
              cache(remote);
              if (pending && !removeDraft(loadedDraft, remote)) return;
            } catch {
              warning = "Account saves loaded. This browser could not cache them.";
            }
            put({ key, ...remote, ready: true, busy: false, dirty: false, error: warning, device });
          }
        } catch (cause) {
          if (alive(run, controller))
            put({
              ...current.current,
              key,
              busy: false,
              ready: false,
              error:
                cause instanceof Error ? cause.message : "Your account saves could not be read.",
            });
        }
      })();
    return () => {
      generation.current++;
      request.current?.abort();
    };
  }, [key, identityReady, put]);
  const update = (next: SavedWorkspace) => {
    const value = current.current;
    if (
      scope.current !== key ||
      !identityIsReady.current ||
      value.key !== key ||
      !value.ready ||
      value.busy ||
      value.dirty
    )
      return false;
    const checked = parseSavedWorkspace(next);
    if (!checked) {
      put({
        ...value,
        error:
          "Saved supports up to 100 places and 50 collections. Your existing saves are unchanged.",
      });
      return false;
    }
    if (same(value.workspace, checked)) return true;
    try {
      if (accountId) {
        if (!writeDraft({ workspace: checked, revision: value.revision })) return false;
        try {
          mirror(checked);
        } catch {
          /* The pending snapshot is already durable. */
        }
        void upload(checked, value.revision);
      } else {
        localStorage.setItem(canonical, JSON.stringify(checked));
        let error = "";
        try {
          mirror(checked);
        } catch {
          error = "Saved on this device. A compatibility cache could not be updated.";
        }
        put({ ...value, workspace: checked, error });
      }
      return true;
    } catch {
      put({
        ...value,
        error: "This browser could not preserve your changes. Your existing saves are unchanged.",
      });
      return false;
    }
  };
  async function reviewAccount() {
    if (
      !accountId ||
      scope.current !== key ||
      !identityIsReady.current ||
      current.current.busy ||
      current.current.key !== key
    )
      return;
    const controller = new AbortController();
    request.current?.abort();
    request.current = controller;
    const run = generation.current;
    put({ ...current.current, busy: true, error: "" });
    try {
      const remote = await responseValue(
        await fetch("/api/saved", {
          headers: { "X-Tastip-Account": accountId },
          cache: "no-store",
          signal: controller.signal,
        }),
      );
      if (alive(run, controller) && checkDraft(draftSeen.current, remote))
        put({ ...current.current, busy: false, remote });
    } catch (cause) {
      if (alive(run, controller))
        put({
          ...current.current,
          busy: false,
          error: cause instanceof Error ? cause.message : "Your account saves could not load.",
        });
    }
  }
  function acceptAccountCopy() {
    const value = current.current;
    if (
      scope.current !== key ||
      !identityIsReady.current ||
      !value.remote ||
      value.busy ||
      value.key !== key
    )
      return false;
    try {
      if (!checkDraft(draftSeen.current, value.remote)) return false;
      const expectedDraft = draftSeen.current;
      if (value.blockedDraft) {
        const raw = localStorage.getItem(draftKey);
        if (raw !== null) preserveRaw(`${recoveryKey}:unreadable-draft`, raw);
      }
      if (value.dirty) preserveRecovery(value.workspace);
      cache(value.remote);
      if (!removeDraft(expectedDraft, value.remote)) return false;
      put({
        ...value,
        ...value.remote,
        ready: true,
        dirty: false,
        blockedDraft: false,
        remote: undefined,
        error: "",
        device: value.dirty ? value.workspace : value.device,
      });
      return true;
    } catch {
      put({ ...value, error: "Your device copy could not be preserved. Nothing was replaced." });
      return false;
    }
  }
  function combine() {
    const value = current.current;
    if (
      scope.current !== key ||
      !identityIsReady.current ||
      !value.remote ||
      value.busy ||
      value.blockedDraft ||
      value.key !== key
    )
      return false;
    try {
      if (!checkDraft(draftSeen.current, value.remote)) return false;
      const local = value.dirty ? value.workspace : value.device;
      if (!local) return false;
      const combined = combineSaved(value.remote.workspace, local);
      preserveRecovery(local);
      if (!writeDraft({ workspace: combined, revision: value.remote.revision })) return false;
      void upload(combined, value.remote.revision);
      return true;
    } catch (cause) {
      put({
        ...value,
        error: cause instanceof Error ? cause.message : "These copies could not be combined.",
      });
      return false;
    }
  }
  const visible = state.key === key && identityReady ? state : initial();
  return {
    ...visible,
    account: Boolean(accountId),
    writable: visible.ready && !visible.busy && !visible.dirty,
    update,
    reviewAccount,
    useAccountCopy: acceptAccountCopy,
    combine,
    retry: () => {
      const value = current.current;
      if (value.key === key && value.dirty && !value.busy)
        void upload(value.workspace, value.revision);
    },
    dismissReview: () => put({ ...current.current, remote: undefined }),
    refresh: reviewAccount,
  };
}
