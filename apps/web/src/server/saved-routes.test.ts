import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Saved routes enforce identity, ownership, CSRF, bounds, revision tombstones and per-owner write limits", () => {
  const directory = mkdtempSync(join(tmpdir(), "tastip-saved-routes-"));
  const script = `
    import { POST as accountPOST } from "./src/app/api/account/route.ts";
    import { GET, POST } from "./src/app/api/saved/route.ts";
    import { getTripStore } from "./src/server/trip-store.ts";
    import { getSavedStore, SavedWorkspaceStore } from "./src/server/saved-store.ts";
    import { openDatabase, databasePath } from "./src/server/database.ts";
    import { DESTINATIONS } from "@tastip/domain";
    const req=(body,cookie,id,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/saved",{method:body?"POST":"GET",headers:{...(body?{origin,"Content-Type":"application/json"}:{}),...(cookie?{cookie}:{}),...(id?{"X-Tastip-Account":id}:{})},...(body?{body:JSON.stringify(body)}:{})});
    async function register(username){const response=await accountPOST(req({action:"register",username,password:"saved-test-password-729"}));return{account:(await response.json()).account,cookie:response.headers.get("Set-Cookie").split(";")[0]};}
    const alice=await register("saved-alice"),bob=await register("saved-bob"),limited=await register("saved-limited");
    const anon=await GET(req());const missing=await GET(req(null,alice.cookie));const switched=await GET(req(null,bob.cookie,alice.account.id));
    const destination=DESTINATIONS[0];const place={id:"qloo:route-save-fixture",destinationId:destination.id,name:"Synthetic route save",description:"Synthetic route fixture, not a real venue.",source:"qloo",category:"culture",lat:destination.lat,lng:destination.lng,taste:{queryId:"saved-route-query",rank:7},practical:{hours:"unknown",cost:"unknown"}};
    const workspace={places:[{place,destination}],collections:[{id:"00000000-0000-4000-8000-000000000029",name:"Private fixture collection",placeIds:[place.id,"orphan:legacy-fixture"]}]};
    const body={action:"save",workspace,expectedRevision:0};
    const saved=await POST(req(body,alice.cookie,alice.account.id));const snapshot=await saved.json();
    const cache=saved.headers.get("Cache-Control");
    const foreign=await GET(req(null,bob.cookie,bob.account.id));const foreignBody=await foreign.json();
    const stale=await POST(req(body,alice.cookie,alice.account.id));
    const csrf=await POST(req({...body,expectedRevision:1},alice.cookie,alice.account.id,"https://foreign.example"));
    const invalid=await POST(req({...body,workspace:{...workspace,collections:[workspace.collections[0],workspace.collections[0]]},expectedRevision:1},alice.cookie,alice.account.id));
    const oversized=await POST(new Request("http://localhost:3000/api/saved",{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json",cookie:alice.cookie,"X-Tastip-Account":alice.account.id,"Content-Length":"4200000"},body:JSON.stringify(body)}));
    const cleared=await POST(req({action:"clear",expectedRevision:1},alice.cookie,alice.account.id));const clearedBody=await cleared.json();
    const resurrection=await POST(req({...body,expectedRevision:1},alice.cookie,alice.account.id));
    const final=await GET(req(null,alice.cookie,alice.account.id));const finalBody=await final.json();
    let writes=0;for(let revision=0;revision<20;revision++){const response=await POST(req({action:"clear",expectedRevision:revision},limited.cookie,limited.account.id));if(response.status===200)writes++;}
    const rate=await POST(req({action:"clear",expectedRevision:20},limited.cookie,limited.account.id));
    const afterRate=await GET(req(null,limited.cookie,limited.account.id));
    getSavedStore().close();getTripStore().close();
    const reopened=new SavedWorkspaceStore(openDatabase(databasePath()));
    const persisted=reopened.get(alice.account.id);
    console.log(JSON.stringify({anon:anon.status,missing:missing.status,switched:switched.status,saved:saved.status,cache,revision:snapshot.revision,query:snapshot.workspace.places[0].place.taste,orphan:snapshot.workspace.collections[0].placeIds[1],foreign:foreignBody,stale:stale.status,csrf:csrf.status,invalid:invalid.status,oversized:oversized.status,cleared:cleared.status,clearRevision:clearedBody.revision,resurrection:resurrection.status,final:finalBody.workspace,persisted: persisted.revision,writes,rate:rate.status,rateRevision:(await afterRate.json()).revision}));
    reopened.close();
  `;
  try {
    const result = spawnSync(
      process.execPath,
      ["--cwd", resolve(import.meta.dir, "../.."), "-e", script],
      {
        encoding: "utf8",
        timeout: 20000,
        env: { ...process.env, NODE_ENV: "test", TASTIP_DATA_DIR: directory },
      },
    );
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      anon: 401,
      missing: 409,
      switched: 409,
      saved: 200,
      cache: "no-store",
      revision: 1,
      query: { queryId: "saved-route-query", rank: 7 },
      orphan: "orphan:legacy-fixture",
      foreign: { workspace: null, revision: 0, updatedAt: null },
      stale: 409,
      csrf: 403,
      invalid: 400,
      oversized: 413,
      cleared: 200,
      clearRevision: 2,
      resurrection: 409,
      final: null,
      persisted: 2,
      writes: 20,
      rate: 429,
      rateRevision: 20,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
