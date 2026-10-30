"use client";

import type { Trip } from "@tastip/domain";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import {
  type DayDiscoveryAccess,
  type DayDiscoveryBinding,
  DayDiscoveryController,
  type DayDiscoveryRadius,
  emptyDayDiscovery,
  isDayDiscoveryRadius,
  prepareDayDiscovery,
} from "./lib/day-discovery";

export {
  DAY_DISCOVERY_RADII,
  type DayDiscoveryBinding,
  type DayDiscoveryRadius,
} from "./lib/day-discovery";

export function useDayDiscovery({
  trip,
  dayId,
  scope,
  enabled,
  active,
}: {
  trip: Trip | null;
  dayId: string;
  scope: string;
  enabled: boolean;
  active: boolean;
}) {
  const providerFetch = useProviderFetch();
  const transport = useRef(providerFetch);
  transport.current = providerFetch;
  const [radius, setRadiusState] = useState<DayDiscoveryRadius>(8000);
  const prepared = prepareDayDiscovery(trip, dayId, scope, radius);
  const blockedReason = !enabled
    ? "Qloo discovery is unavailable until provider access and preferences are ready."
    : prepared.error;
  const access = useRef<DayDiscoveryAccess>({
    context: prepared.context,
    enabled,
    active,
    blockedReason,
  });
  access.current = { context: prepared.context, enabled, active, blockedReason };
  const [snapshot, setSnapshot] = useState(emptyDayDiscovery);
  const controller = useRef<DayDiscoveryController | null>(null);
  if (!controller.current)
    controller.current = new DayDiscoveryController(
      () => access.current,
      setSnapshot,
      (input, init) => transport.current(input, init),
    );
  const engine = controller.current;
  const key = prepared.context?.key;
  // biome-ignore lint/correctness/useExhaustiveDependencies: The engine reads current access from a ref; every access boundary must trigger cancellation.
  useEffect(() => {
    engine.synchronize();
    return () => engine.dispose();
  }, [engine, key, enabled, active, blockedReason]);
  const find = useCallback(() => engine.find(), [engine]);
  const stop = useCallback(() => engine.stop(), [engine]);
  const retry = useCallback(() => engine.retry(), [engine]);
  const clear = useCallback(() => engine.clear(), [engine]);
  const isCurrent = useCallback(
    (binding: DayDiscoveryBinding) => engine.isCurrent(binding),
    [engine],
  );
  const setRadius = useCallback(
    (value: number) => {
      if (!isDayDiscoveryRadius(value)) return false;
      // No same-frame Find can spend against the previous radius before React re-renders.
      access.current = { ...access.current, active: false };
      engine.clear();
      setRadiusState(value);
      return true;
    },
    [engine],
  );
  // Hide stale candidates during render, before the effect can cancel the old request.
  const visible =
    active && enabled && key && snapshot.contextKey === key
      ? snapshot
      : emptyDayDiscovery(key ?? null);
  return {
    ...visible,
    status: !enabled || !prepared.context ? ("unavailable" as const) : visible.status,
    destination: prepared.destination,
    radius,
    canFind: active && enabled && Boolean(prepared.context) && visible.status !== "loading",
    blockedReason,
    setRadius,
    find,
    stop,
    retry,
    clear,
    isCurrent,
  };
}
