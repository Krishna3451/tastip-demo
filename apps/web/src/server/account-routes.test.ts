import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/** Exercise actual Next route exports without binding a server socket or mocking persistence. */
test("account and trip handlers round-trip cookies, revisions, ownership, shares and identity headers", () => {
  const directory = mkdtempSync(join(tmpdir(), "tastip-account-routes-"));
  const script = `
    import {GET as accountGET,POST as accountPOST} from "./src/app/api/account/route.ts";
    import {GET as tripsGET,POST as tripsPOST} from "./src/app/api/trips/route.ts";
    import {getTripStore} from "./src/server/trip-store.ts";
    import {createDemoTrip,DEFAULT_BRIEF,applyTripCommand} from "@tastip/domain";
    const request=(path,body,cookie,id)=>new Request("http://localhost:3000/api/"+path,{method:body?"POST":"GET",headers:{...(body?{origin:"http://localhost:3000","Content-Type":"application/json"}:{}),...(cookie?{cookie}:{}),...(id?{"X-Tastip-Account":id}:{})},...(body?{body:JSON.stringify(body)}:{})});
    const anonymous=await tripsGET(request("trips"));
    const registered=await accountPOST(request("account",{action:"register",username:"route-alice",password:"route-test-password-729"}));
    const alice=(await registered.json()).account; const cookie=registered.headers.get("Set-Cookie").split(";")[0];
    const bootstrap=await accountGET(request("account",null,cookie));
    const trip=createDemoTrip(DEFAULT_BRIEF);
    const missingIdentity=await tripsPOST(request("trips",{action:"save",trip,expectedRevision:null},cookie));
    const saved=await tripsPOST(request("trips",{action:"save",trip,expectedRevision:null},cookie,alice.id)); const savedBody=await saved.json();
    const replay=await tripsPOST(request("trips",{action:"save",trip,expectedRevision:null},cookie,alice.id));
    const list=await tripsGET(request("trips",null,cookie,alice.id)); const listBody=await list.json();
    const shared=await tripsPOST(request("trips",{action:"share",id:trip.id,expectedRevision:savedBody.revision},cookie,alice.id)); const share=await shared.json();
    const shareList=await tripsGET(request("trips?shares="+trip.id,null,cookie,alice.id));
    const updated=applyTripCommand(trip,{id:"route-update",baseVersion:trip.version,operations:[{type:"pin-stop",stopId:trip.stops[0].id,pinned:true}]}).trip;
    await tripsPOST(request("trips",{action:"save",trip:updated,expectedRevision:savedBody.revision},cookie,alice.id));
    const staleShare=await tripsPOST(request("trips",{action:"share",id:trip.id,expectedRevision:savedBody.revision},cookie,alice.id));
    const registeredBob=await accountPOST(request("account",{action:"register",username:"route-bob",password:"route-test-password-729"}));
    const bob=(await registeredBob.json()).account; const bobCookie=registeredBob.headers.get("Set-Cookie").split(";")[0];
    const staleTab=await tripsPOST(request("trips",{action:"save",trip,expectedRevision:null},bobCookie,alice.id));
    const foreignRead=await tripsGET(request("trips?id="+trip.id,null,bobCookie,bob.id));
    const foreignRevoke=await tripsPOST(request("trips",{action:"revoke",token:share.token},bobCookie,bob.id));
    const revoke=await tripsPOST(request("trips",{action:"revoke",token:share.token},cookie,alice.id));
    let gone=false;try{getTripStore().shared(share.token);}catch{gone=true;}
    const csrf=await tripsPOST(new Request("http://localhost:3000/api/trips",{method:"POST",headers:{origin:"https://elsewhere.example","Content-Type":"application/json",cookie,"X-Tastip-Account":alice.id},body:JSON.stringify({action:"save",trip,expectedRevision:1})}));
    const logout=await accountPOST(request("account",{action:"logout"},cookie,alice.id));
    const afterLogout=await accountGET(request("account",null,cookie));
    console.log(JSON.stringify({anonymous:anonymous.status,registered:registered.status,bootstrap:(await bootstrap.json()).account.id===alice.id,missingIdentity:missingIdentity.status,saved:saved.status,revision:savedBody.revision,replayed:(await replay.json()).replayed,undated:listBody.trips[0].startDate,shares:(await shareList.json()).shares.length,staleShare:staleShare.status,staleTab:staleTab.status,foreignRead:foreignRead.status,foreignRevoke:foreignRevoke.status,revoked:revoke.status,gone,csrf:csrf.status,logout:logout.status,cleared:(await afterLogout.json()).account===null}));
    getTripStore().close();
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
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout.trim())).toEqual({
      anonymous: 401,
      registered: 200,
      bootstrap: true,
      missingIdentity: 409,
      saved: 200,
      revision: 1,
      replayed: true,
      undated: null,
      shares: 1,
      staleShare: 409,
      staleTab: 409,
      foreignRead: 404,
      foreignRevoke: 404,
      revoked: 200,
      gone: true,
      csrf: 403,
      logout: 200,
      cleared: true,
    });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
