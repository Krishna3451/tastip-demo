import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("private chat backups enforce identity, origin, ownership, revisions, bounds and cleared tombstones", () => {
  const directory = mkdtempSync(join(tmpdir(), "tastip-chat-routes-"));
  const script = `
    import { POST as accountPOST } from "./src/app/api/account/route.ts";
    import { GET, POST } from "./src/app/api/conversations/route.ts";
    import { getTripStore, TripStore } from "./src/server/trip-store.ts";
    import { openDatabase, databasePath } from "./src/server/database.ts";
    const req=(body,cookie,id,origin="http://localhost:3000")=>new Request("http://localhost:3000/api/conversations",{method:body?"POST":"GET",headers:{...(body?{origin,"Content-Type":"application/json"}:{}),...(cookie?{cookie}:{}),...(id?{"X-Tastip-Account":id}:{})},...(body?{body:JSON.stringify(body)}:{})});
    async function register(username) { const response=await accountPOST(req({action:"register",username,password:"chat-test-password-729"})); return {account:(await response.json()).account,cookie:response.headers.get("Set-Cookie").split(";")[0]}; }
    const alice=await register("chat-alice"), bob=await register("chat-bob");
    const anon=await GET(req());
    const missing=await GET(req(null,alice.cookie));
    const switched=await GET(req(null,bob.cookie,alice.account.id));
    const chat={id:"chat-1",title:"Private history",updatedAt:10,pendingMessage:"Do not resume this",messages:[{id:"message-1",role:"user",text:"My private request"}]};
    const body={action:"save",conversations:[chat],expectedRevision:0};
    const saved=await POST(req(body,alice.cookie,alice.account.id)); const snapshot=await saved.json();
    const foreign=await GET(req(null,bob.cookie,bob.account.id)); const foreignBody=await foreign.json();
    const stale=await POST(req(body,alice.cookie,alice.account.id));
    const csrf=await POST(req({...body,expectedRevision:1},alice.cookie,alice.account.id,"https://foreign.example"));
    const invalid=await POST(req({...body,conversations:[chat,chat],expectedRevision:1},alice.cookie,alice.account.id));
    const oversized=await POST(new Request("http://localhost:3000/api/conversations",{method:"POST",headers:{origin:"http://localhost:3000","Content-Type":"application/json",cookie:alice.cookie,"X-Tastip-Account":alice.account.id,"Content-Length":"6000000"},body:JSON.stringify(body)}));
    const cleared=await POST(req({action:"clear",expectedRevision:1},alice.cookie,alice.account.id)); const clearedBody=await cleared.json();
    const resurrection=await POST(req({...body,expectedRevision:1},alice.cookie,alice.account.id));
    const final=await GET(req(null,alice.cookie,alice.account.id)); const finalBody=await final.json();
    const store=getTripStore(); store.close();
    const reopenedStore=new TripStore(openDatabase(databasePath()));
    const reopened=reopenedStore.conversationBackup(alice.account.id);
    console.log(JSON.stringify({anon:anon.status,missing:missing.status,switched:switched.status,saved:saved.status,revision:snapshot.revision,text:snapshot.conversations[0].messages[0].text,pending:snapshot.conversations[0].pendingMessage??null,foreign:foreignBody.conversations,stale:stale.status,csrf:csrf.status,invalid:invalid.status,oversized:oversized.status,cleared:cleared.status,clearRevision:clearedBody.revision,resurrection:resurrection.status,final:finalBody.conversations,reopened:reopened.revision}));
    reopenedStore.close();
  `;
  try {
    const result = spawnSync(
      process.execPath,
      ["--cwd", resolve(import.meta.dir, "../.."), "-e", script],
      {
        encoding: "utf8",
        timeout: 15000,
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
      revision: 1,
      text: "My private request",
      pending: null,
      foreign: null,
      stale: 409,
      csrf: 403,
      invalid: 400,
      oversized: 413,
      cleared: 200,
      clearRevision: 2,
      resurrection: 409,
      final: null,
      reopened: 2,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
