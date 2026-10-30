import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const browserKey = "synthetic-dedicated-maps-browser-key";
const serverKeys = {
  OPENAI_API_KEY: "synthetic-private-openai-server-key",
  QLOO_API_KEY: "synthetic-private-qloo-server-key",
};

/** Every child owns its database and module/env state; no live or shared store is used. */
function run(script: string, environment: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "tastip-maps-config-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--cwd", resolve(import.meta.dir, "../.."), "-e", script],
      {
        encoding: "utf8",
        timeout: 20_000,
        env: {
          ...process.env,
          NODE_ENV: "production",
          TASTIP_DATA_DIR: directory,
          TASTIP_ENABLE_GOOGLE_MAPS: "1",
          GOOGLE_MAPS_BROWSER_KEY: browserKey,
          NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: "synthetic-legacy-build-time-key",
          TASTIP_ENABLE_HOSTED_PROVIDERS: "1",
          TASTIP_APP_ORIGIN: "https://tastip.example",
          TASTIP_INTERNAL_ORIGIN: "https://0.0.0.0:3000",
          TASTIP_DAILY_PROVIDER_LIMIT: "1",
          TASTIP_GLOBAL_PROVIDER_LIMIT: "1",
          ...serverKeys,
          ...environment,
        },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    return JSON.parse(result.stdout.trim());
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

const harness = `
  import assert from "node:assert/strict";
  import { readdirSync } from "node:fs";
  import { GET } from "./src/app/api/maps/config/route.ts";
  import { getTripStore } from "./src/server/trip-store.ts";
  import { openDatabase, databasePath } from "./src/server/database.ts";
  let upstreamCalls = 0;
  globalThis.fetch = async () => { upstreamCalls++; throw new Error("Unexpected synthetic upstream call"); };
  const publicOrigin = "https://tastip.example";
  function request(entry, { owner = true, origin = publicOrigin, referer = publicOrigin + "/home", fetchSite = "same-origin", base = publicOrigin, extra = {} } = {}) {
    return new Request(base + "/api/maps/config", { headers: {
      ...(origin !== null ? { Origin: origin } : {}),
      ...(referer !== null ? { Referer: referer } : {}),
      ...(fetchSite !== null ? { "Sec-Fetch-Site": fetchSite } : {}),
      ...(entry ? { Cookie: "tastip_session=" + entry.token } : {}),
      ...(entry && owner ? { "X-Tastip-Account": owner === true ? entry.account.id : owner } : {}),
      ...extra,
    } });
  }
  async function read(req, expected) {
    const response = GET(req);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    assert.equal(response.headers.get("X-Content-Type-Options"), "nosniff");
    const serialized = await response.text();
    for (const secret of [process.env.OPENAI_API_KEY, process.env.QLOO_API_KEY])
      if (secret) assert.ok(!serialized.includes(secret.trim()), "Server-only credential crossed the config boundary");
    const body = JSON.parse(serialized);
    assert.deepEqual(body, expected);
    return body;
  }
  const disabled = { enabled: false };
  const enabled = (apiKey = process.env.GOOGLE_MAPS_BROWSER_KEY.trim()) => ({ enabled: true, provider: "google-maps-3d", apiKey });
`;

test("disabled, absent, malformed and misassigned map config never opens a database or returns server secrets", () => {
  const result = run(`${harness}
    const shapedCookie = { token: "a".repeat(43), account: { id: "00000000-0000-4000-8000-000000000019" } };
    const req = request(shapedCookie);
    const good = process.env.GOOGLE_MAPS_BROWSER_KEY;
    const outcomes = [];
    for (const flag of [undefined, "0", "true"]) {
      if (flag === undefined) delete process.env.TASTIP_ENABLE_GOOGLE_MAPS;
      else process.env.TASTIP_ENABLE_GOOGLE_MAPS = flag;
      outcomes.push(await read(req, disabled));
    }
    process.env.TASTIP_ENABLE_GOOGLE_MAPS = "1";
    for (const key of [undefined, "", "   ", "synthetic embedded whitespace", "x".repeat(257), process.env.OPENAI_API_KEY, "  " + process.env.QLOO_API_KEY + "  "]) {
      if (key === undefined) delete process.env.GOOGLE_MAPS_BROWSER_KEY;
      else process.env.GOOGLE_MAPS_BROWSER_KEY = key;
      outcomes.push(await read(req, disabled));
    }
    // A syntactically valid cookie would create the lazy store if access checks ran.
    assert.deepEqual(readdirSync(process.env.TASTIP_DATA_DIR), []);
    assert.equal(upstreamCalls, 0);
    console.log(JSON.stringify({ disabledCases: outcomes.length, noDatabase: true, upstreamCalls }));
  `);
  expect(result).toEqual({ disabledCases: 10, noDatabase: true, upstreamCalls: 0 });
});

test("hosted maps config needs the canonical source, real session and matching rendered owner without spending provider quotas", () => {
  const result = run(`${harness}
    const store = getTripStore();
    const alice = await store.register("synthetic-map-alice", "Synthetic-maps-password-628");
    const bob = await store.register("synthetic-map-bob", "Synthetic-maps-password-628");
    const db = openDatabase(databasePath());
    const buckets = () => db.prepare("SELECT bucket,count,expires_at FROM rate_buckets ORDER BY bucket").all();
    const before = buckets();
    await read(request(alice), enabled());
    await read(request(alice, { origin: null }), enabled());
    await read(request(alice, { base: "https://0.0.0.0:3000" }), enabled());
    await read(request(alice, { base: "http://localhost:3000" }), enabled());
    const denied = [
      request(), request(undefined, { extra: { "X-Tastip-Account": alice.account.id } }),
      request(alice, { owner: false }), request(alice, { owner: bob.account.id }),
      request(bob, { owner: alice.account.id }),
      request(alice, { origin: "https://foreign.example" }),
      request(alice, { origin: "https://foreign.example", extra: { "X-Forwarded-Host": "tastip.example", "X-Forwarded-Proto": "https" } }),
      request(alice, { fetchSite: "cross-site" }), request(alice, { fetchSite: "same-site" }),
      request(alice, { origin: null, referer: "https://foreign.example/home" }),
      request(alice, { origin: null, referer: null }), request(alice, { origin: "null" }),
      request(alice, { base: "https://foreign.example", extra: { "Host": "tastip.example", "X-Forwarded-Host": "tastip.example", "X-Forwarded-Proto": "https" } }),
      request(alice, { base: "http://tastip.example" }),
      request(alice, { base: "https://0.0.0.0:3001" }),
      request(alice, { extra: { Cookie: "tastip_session=" + alice.token + "; tastip_session=" + alice.token } }),
    ];
    for (const req of denied) await read(req, disabled);
    for (let index = 0; index < 40; index++) await read(request(alice), enabled());
    assert.deepEqual(buckets(), before, "Config reads must not consume any quota buckets");
    assert.equal(db.prepare("SELECT COUNT(*) AS total FROM rate_buckets WHERE bucket LIKE 'provider:%'").get().total, 0);
    store.logout(alice.token);
    await read(request(alice), disabled);
    await read(request(bob), enabled());
    assert.deepEqual(buckets(), before);
    assert.equal(upstreamCalls, 0);
    db.close(); store.close();
    console.log(JSON.stringify({ deniedCases: denied.length, quotaUnchanged: true, revocation: true, upstreamCalls }));
  `);
  expect(result).toEqual({
    deniedCases: 16,
    quotaUnchanged: true,
    revocation: true,
    upstreamCalls: 0,
  });
});

test("map config reads current runtime toggles and dedicated keys without reusing stale or server credentials", () => {
  const result = run(`${harness}
    const store = getTripStore();
    const alice = await store.register("synthetic-map-runtime", "Synthetic-maps-password-629");
    const req = request(alice);
    const original = process.env.GOOGLE_MAPS_BROWSER_KEY;
    await read(req, enabled());
    process.env.GOOGLE_MAPS_BROWSER_KEY = "  synthetic-runtime-rotated-browser-key  ";
    await read(req, enabled("synthetic-runtime-rotated-browser-key"));
    process.env.TASTIP_ENABLE_GOOGLE_MAPS = "0";
    await read(req, disabled);
    process.env.TASTIP_ENABLE_GOOGLE_MAPS = "1";
    process.env.GOOGLE_MAPS_BROWSER_KEY = original;
    process.env.TASTIP_ENABLE_HOSTED_PROVIDERS = "0";
    await read(req, disabled);
    process.env.TASTIP_ENABLE_HOSTED_PROVIDERS = "1";
    for (const invalid of [undefined, "http://tastip.example", "https://tastip.example/", "https://tastip.example/path", "not-an-origin"]) {
      if (invalid === undefined) delete process.env.TASTIP_APP_ORIGIN;
      else process.env.TASTIP_APP_ORIGIN = invalid;
      await read(req, disabled);
    }
    process.env.TASTIP_APP_ORIGIN = publicOrigin;
    await read(req, enabled());
    for (const secret of [process.env.OPENAI_API_KEY, process.env.QLOO_API_KEY]) {
      process.env.GOOGLE_MAPS_BROWSER_KEY = secret;
      await read(req, disabled);
    }
    delete process.env.GOOGLE_MAPS_BROWSER_KEY;
    await read(req, disabled); // A legacy NEXT_PUBLIC key must never act as runtime fallback.
    assert.equal(upstreamCalls, 0);
    store.close();
    console.log(JSON.stringify({ runtimeRevocation: true, runtimeRotation: true, noLegacyOrServerKeyFallback: true, upstreamCalls }));
  `);
  expect(result).toEqual({
    runtimeRevocation: true,
    runtimeRotation: true,
    noLegacyOrServerKeyFallback: true,
    upstreamCalls: 0,
  });
});

test("local development accepts only equivalent loopback protocol and port source headers, with Origin taking precedence", () => {
  const result = run(
    `${harness}
      const target = "http://localhost:3000";
      for (const source of ["http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"])
        await read(request(undefined, { base: target, origin: source }), enabled());
      await read(request(undefined, { base: target, origin: null, referer: "http://127.0.0.1:3000/home?synthetic=1" }), enabled());
      await read(request(undefined, { base: "https://localhost:3000", origin: "https://127.0.0.1:3000" }), enabled());
      const denied = [
        { origin: "https://localhost:3000" }, { origin: "http://localhost:3001" },
        { origin: "http://foreign.example:3000" }, { origin: "http://localhost.attacker.example:3000" },
        { origin: "http://localhost:3000/path" }, { origin: "http://user:pass@localhost:3000" },
        { origin: "null" }, { origin: "malformed" },
        { origin: null, referer: "http://localhost:3001/home" },
        { origin: null, referer: "https://localhost:3000/home" },
        { origin: null, referer: "http://foreign.example:3000/home" }, { origin: null, referer: null },
        { origin: "http://foreign.example:3000", referer: "http://localhost:3000/home" },
        { origin: "http://localhost:3000", fetchSite: "cross-site" },
        { origin: "http://localhost:3000", extra: { "X-Tastip-Account": "00000000-0000-4000-8000-000000000019" } },
        { base: "http://0.0.0.0:3000", origin: "http://localhost:3000" },
        { origin: "http://foreign.example:3000", extra: { "X-Forwarded-Host": "localhost:3000", "X-Forwarded-Proto": "http" } },
      ];
      for (const options of denied) await read(request(undefined, { base: target, ...options }), disabled);
      assert.deepEqual(readdirSync(process.env.TASTIP_DATA_DIR), []);
      assert.equal(upstreamCalls, 0);
      console.log(JSON.stringify({ allowedCases: 5, deniedCases: denied.length, noDatabase: true, upstreamCalls }));
    `,
    { NODE_ENV: "development", TASTIP_ENABLE_HOSTED_PROVIDERS: "0" },
  );
  expect(result).toEqual({ allowedCases: 5, deniedCases: 17, noDatabase: true, upstreamCalls: 0 });
});
