import { afterEach, describe, expect, test } from "bun:test";
import {
  assertAccountIdentity,
  providerAvailable,
  requireAccount,
  sessionToken,
  setSessionCookie,
} from "./account-http";

const environment = process.env as Record<string, string | undefined>;
const previous = {
  node: process.env.NODE_ENV,
  enabled: process.env.TASTIP_ENABLE_HOSTED_PROVIDERS,
  origin: process.env.TASTIP_APP_ORIGIN,
};
afterEach(() => {
  for (const [name, value] of Object.entries({
    NODE_ENV: previous.node,
    TASTIP_ENABLE_HOSTED_PROVIDERS: previous.enabled,
    TASTIP_APP_ORIGIN: previous.origin,
  })) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});
const token = "a".repeat(43);

describe("account HTTP boundary", () => {
  test("extracts only one correctly shaped session cookie", () => {
    expect(
      sessionToken(
        new Request("http://localhost/api/account", {
          headers: { cookie: `other=one; tastip_session=${token}; more=two` },
        }),
      ),
    ).toBe(token);
    expect(
      sessionToken(
        new Request("http://localhost/api/account", {
          headers: { cookie: `tastip_session=${token}; tastip_session=${token}` },
        }),
      ),
    ).toBeUndefined();
    expect(
      sessionToken(
        new Request("http://localhost/api/account", {
          headers: { cookie: "tastip_session=not-a-token" },
        }),
      ),
    ).toBeUndefined();
    expect(sessionToken(new Request("http://localhost/api/account"))).toBeUndefined();
  });
  test("requires a visible account match before owned reads or writes", () => {
    const account = { id: "alice", username: "alice" };
    expect(
      assertAccountIdentity(
        new Request("http://localhost/api/trips", { headers: { "X-Tastip-Account": "alice" } }),
        account,
      ),
    ).toEqual(account);
    expect(() =>
      assertAccountIdentity(
        new Request("http://localhost/api/trips", { headers: { "X-Tastip-Account": "bob" } }),
        account,
      ),
    ).toThrow("sign-in changed");
    expect(() => assertAccountIdentity(new Request("http://localhost/api/trips"), account)).toThrow(
      "sign-in changed",
    );
    expect(() => requireAccount(new Request("http://localhost/api/trips"))).toThrow("Sign in");
  });
  test("cookies are HttpOnly, scoped, SameSite and secure on HTTPS or production", () => {
    environment.NODE_ENV = "development";
    const local = setSessionCookie(
      new Response(),
      token,
      new Request("http://localhost/api/account"),
    ).headers.get("Set-Cookie");
    expect(local).toContain("HttpOnly; Path=/; SameSite=Lax; Max-Age=604800");
    expect(local).not.toContain("Secure");
    expect(
      setSessionCookie(
        new Response(),
        token,
        new Request("https://tastip.example/api/account"),
      ).headers.get("Set-Cookie"),
    ).toContain("; Secure");
    environment.NODE_ENV = "production";
    expect(
      setSessionCookie(
        new Response(),
        token,
        new Request("http://localhost/api/account"),
      ).headers.get("Set-Cookie"),
    ).toContain("; Secure");
    expect(
      setSessionCookie(
        new Response(),
        "ignored",
        new Request("https://tastip.example/api/account"),
        true,
      ).headers.get("Set-Cookie"),
    ).toContain("tastip_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0");
    expect(() =>
      setSessionCookie(
        new Response(),
        "invalid; leaked=value",
        new Request("http://localhost/api/account"),
      ),
    ).toThrow("session could not");
  });
  test("hosted provider opt-in never admits unconfigured HTTP, wrong origins or anonymous access", () => {
    environment.NODE_ENV = "production";
    process.env.TASTIP_ENABLE_HOSTED_PROVIDERS = "1";
    process.env.TASTIP_APP_ORIGIN = "https://tastip.example";
    expect(providerAvailable(new Request("https://other.example/api/taste"))).toBe(false);
    expect(providerAvailable(new Request("http://tastip.example/api/taste"))).toBe(false);
    expect(providerAvailable(new Request("https://tastip.example/api/taste"))).toBe(false);
    process.env.TASTIP_APP_ORIGIN = "https://tastip.example/extra-path";
    expect(providerAvailable(new Request("https://tastip.example/api/taste"))).toBe(false);
    process.env.TASTIP_APP_ORIGIN = "not-a-url";
    expect(providerAvailable(new Request("https://tastip.example/api/taste"))).toBe(false);
    environment.NODE_ENV = "development";
    expect(providerAvailable(new Request("http://127.0.0.1:3000/api/taste"))).toBe(true);
  });
});
