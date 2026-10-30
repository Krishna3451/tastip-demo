import { expect, test } from "bun:test";
import {
  createProviderFetch,
  type ProviderFetch,
  providerRequestHeaders,
} from "../../../lib/provider-fetch";

const origin = "https://tastip.example";

test("provider identity headers are cloned, replaced and removed for a signed-out caller", () => {
  const initial = new Headers({
    "Content-Type": "application/json",
    "X-Tastip-Account": "wrong-owner",
  });
  const alice = providerRequestHeaders("alice", initial);
  expect(alice.get("X-Tastip-Account")).toBe("alice");
  expect(alice.get("Content-Type")).toBe("application/json");
  expect(initial.get("X-Tastip-Account")).toBe("wrong-owner");
  expect(providerRequestHeaders(null, initial).has("X-Tastip-Account")).toBe(false);
});

test("a rendered owner stays captured while request body, headers and cancellation survive", async () => {
  const captured: { input: RequestInfo | URL; init: RequestInit | undefined }[] = [];
  const transport: ProviderFetch = async (input, init) => {
    captured.push({ input, init });
    return Response.json({ ok: true });
  };
  const access = { accountId: "alice" as string | null, ready: true };
  const staleAlice = createProviderFetch(access, transport, origin);
  access.accountId = "bob";
  const bob = createProviderFetch(access, transport, origin);
  const controller = new AbortController();
  const body = JSON.stringify({ message: "Synthetic private transport fixture" });
  const headers = { "Content-Type": "application/json", Accept: "application/x-ndjson" };
  await staleAlice("/api/chat", { method: "POST", body, headers, signal: controller.signal });
  await bob("/api/taste", { method: "POST", body: "{}" });
  expect(new Headers(captured[0]?.init?.headers).get("X-Tastip-Account")).toBe("alice");
  expect(new Headers(captured[1]?.init?.headers).get("X-Tastip-Account")).toBe("bob");
  expect(captured[0]?.init?.body).toBe(body);
  expect(captured[0]?.init?.signal).toBe(controller.signal);
  expect(new Headers(captured[0]?.init?.headers).get("Accept")).toBe("application/x-ndjson");
  expect(captured[0]?.init?.credentials).toBe("same-origin");
  expect(captured[0]?.init?.redirect).toBe("error");
  controller.abort();
  expect(captured[0]?.init?.signal?.aborted).toBe(true);
  expect(headers).not.toHaveProperty("X-Tastip-Account");
});

test("identity loading and destinations outside the fixed same-origin allowlist never reach fetch", async () => {
  let calls = 0;
  const transport: ProviderFetch = async () => {
    calls++;
    return Response.json({ ok: true });
  };
  await expect(
    createProviderFetch({ accountId: null, ready: false }, transport, origin)("/api/chat"),
  ).rejects.toThrow("sign-in");
  const providerFetch = createProviderFetch({ accountId: "alice", ready: true }, transport, origin);
  for (const url of [
    "https://api.openai.com/v1/realtime/calls",
    "//other.example/api/chat",
    "https://tastip.example.evil/api/chat",
    "/api/account",
    "/api/chat/private",
    "/api/voice",
    "/api/%63hat",
  ])
    await expect(providerFetch(url)).rejects.toThrow("own provider API");
  expect(calls).toBe(0);
  for (const path of [
    "/api/chat",
    "/api/taste",
    "/api/taste/search",
    "/api/voice/session",
    "/api/routes",
    "/api/health",
    "/api/maps/config",
  ])
    await providerFetch(path);
  expect(calls).toBe(7);
});

test("Request objects retain their input headers and body without leaking a supplied owner", async () => {
  const original = new Request(`${origin}/api/chat`, {
    method: "POST",
    body: "synthetic body",
    headers: { "Content-Type": "text/plain", "X-Tastip-Account": "old-owner" },
  });
  let result: Request | undefined;
  const transport: ProviderFetch = async (input, init) => {
    result = new Request(input, init);
    return Response.json({ ok: true });
  };
  const providerFetch = createProviderFetch({ accountId: null, ready: true }, transport, origin);
  await providerFetch(original);
  expect(result?.headers.has("X-Tastip-Account")).toBe(false);
  expect(result?.headers.get("Content-Type")).toBe("text/plain");
  expect(original.headers.get("X-Tastip-Account")).toBe("old-owner");
  expect(await result?.text()).toBe("synthetic body");
});
