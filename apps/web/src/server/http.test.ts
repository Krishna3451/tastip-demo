import { describe, expect, test } from "bun:test";
import { ProviderError } from "@tastip/providers";
import { z } from "zod";
import { localIntegrationEnabled, readJson, routeError } from "./http";

const schema = z.object({ message: z.string().min(1).max(20) });
function request(body: string, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body,
  });
}

describe("API boundary", () => {
  test("same-origin JSON is validated and cross-origin calls are rejected", async () => {
    expect(await readJson(request('{"message":"hello"}'), schema)).toEqual({ message: "hello" });
    await expect(
      readJson(request('{"message":"hello"}', "https://elsewhere.example"), schema),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN", status: 403 });
  });
  test("malformed, oversized and invalid input cannot reach providers", async () => {
    await expect(readJson(request("not-json"), schema)).rejects.toMatchObject({
      code: "INVALID_JSON",
    });
    await expect(readJson(request('{"message":""}'), schema)).rejects.toMatchObject({
      code: "INVALID_INPUT",
    });
    await expect(
      readJson(request(JSON.stringify({ message: "x".repeat(70_000) })), schema),
    ).rejects.toMatchObject({ code: "BODY_TOO_LARGE", status: 413 });
  });
  test("equivalent Next development loopback origins work without admitting other ports or sites", async () => {
    expect(await readJson(request('{"message":"hello"}', "http://127.0.0.1:3000"), schema)).toEqual(
      { message: "hello" },
    );
    await expect(
      readJson(request('{"message":"hello"}', "http://127.0.0.1:4000"), schema),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
    await expect(
      readJson(request('{"message":"hello"}', "http://localhost.attacker.example:3000"), schema),
    ).rejects.toMatchObject({ code: "INVALID_ORIGIN" });
  });
  test("paid integrations are loopback development only", () => {
    expect(
      localIntegrationEnabled(new Request("http://localhost:3000/api/chat"), "development"),
    ).toBe(true);
    expect(
      localIntegrationEnabled(new Request("http://127.0.0.1:3000/api/chat"), "development"),
    ).toBe(true);
    expect(
      localIntegrationEnabled(new Request("https://preview.example/api/chat"), "development"),
    ).toBe(false);
    expect(
      localIntegrationEnabled(new Request("http://localhost:3000/api/chat"), "production"),
    ).toBe(false);
  });
  test("errors use no-store responses and hide unknown failure details", async () => {
    const unconfigured = routeError(
      new ProviderError("PROVIDER_NOT_CONFIGURED", "Connect your key on the server."),
    );
    expect(unconfigured.status).toBe(503);
    expect(unconfigured.headers.get("Cache-Control")).toBe("no-store");
    const unknown = routeError(new Error("private-debug-body"));
    expect(await unknown.text()).not.toContain("private-debug-body");
  });
});
