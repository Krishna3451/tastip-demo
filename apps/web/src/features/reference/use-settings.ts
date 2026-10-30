"use client";

import { assistantPreferencesSchema } from "@tastip/providers";
import { useCallback, useEffect, useRef, useState } from "react";
import { z } from "zod";

const schema = z.object({
  assistant: assistantPreferencesSchema.default({ voice: "marin", style: "neutral", memory: true }),
  region: z
    .enum([
      "India",
      "United States",
      "United Kingdom",
      "Australia",
      "Canada",
      "France",
      "Germany",
      "Japan",
      "Portugal",
    ])
    .default("India"),
  currency: z.enum(["INR", "USD", "GBP", "EUR", "AUD", "CAD", "JPY"]).default("INR"),
  units: z.enum(["metric", "imperial"]).default("metric"),
  timeZone: z
    .string()
    .max(80)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat("en", { timeZone: value });
        return true;
      } catch {
        return false;
      }
    })
    .default("Asia/Kolkata"),
  notifications: z
    .record(z.string().max(100), z.object({ email: z.boolean(), push: z.boolean() }))
    .refine((value) => Object.keys(value).length <= 50)
    .default({}),
  analytics: z.boolean().default(false),
  marketing: z.boolean().default(false),
});
export type WorkspaceSettings = z.infer<typeof schema>;
export const DEFAULT_SETTINGS = schema.parse({});
export function useSettings(scope: string, ready: boolean) {
  const key = `tastip.reference.settings:${scope}`;
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ key: "", writable: false, settings: DEFAULT_SETTINGS });
  useEffect(() => {
    if (!ready) return;
    function read() {
      try {
        const parsed = schema.safeParse(JSON.parse(localStorage.getItem(key) ?? "{}"));
        current.current = {
          key,
          writable: parsed.success,
          settings: parsed.success ? parsed.data : DEFAULT_SETTINGS,
        };
        setSettings(current.current.settings);
        setError(
          parsed.success
            ? null
            : "Some preferences could not be read. Your saved copy has been kept.",
        );
      } catch {
        current.current = { key, writable: false, settings: DEFAULT_SETTINGS };
        setError("Your browser could not read saved preferences.");
      }
      setLoadedKey(key);
    }
    read();
    const changed = (event: StorageEvent) => {
      if (event.key === key || event.key === null) read();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key, ready]);
  const update = useCallback(
    (patch: Partial<WorkspaceSettings>) => {
      if (current.current.key !== key || !current.current.writable) return false;
      const parsed = schema.safeParse({ ...current.current.settings, ...patch });
      if (!parsed.success) return false;
      try {
        localStorage.setItem(key, JSON.stringify(parsed.data));
        current.current.settings = parsed.data;
        setSettings(parsed.data);
        setError(null);
        return true;
      } catch {
        setError("Your browser could not save these preferences.");
        return false;
      }
    },
    [key],
  );
  return {
    settings: loadedKey === key ? settings : DEFAULT_SETTINGS,
    ready: ready && loadedKey === key,
    error,
    update,
  };
}
