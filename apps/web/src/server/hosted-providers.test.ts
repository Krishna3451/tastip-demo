import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

function run(script: string) {
  const directory = mkdtempSync(join(tmpdir(), "tastip-hosted-providers-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--cwd", resolve(import.meta.dir, "../.."), "-e", script],
      {
        encoding: "utf8",
        timeout: 20000,
        env: {
          ...process.env,
          NODE_ENV: "production",
          TASTIP_DATA_DIR: directory,
          TASTIP_ENABLE_HOSTED_PROVIDERS: "1",
          TASTIP_APP_ORIGIN: "https://tastip.example",
          TASTIP_DAILY_PROVIDER_LIMIT: "100",
          TASTIP_GLOBAL_PROVIDER_LIMIT: "1000",
          OPENAI_API_KEY: "synthetic-inert-provider-key",
          QLOO_API_KEY: "synthetic-inert-provider-key",
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

test("hosted provider routes require opt-in, exact HTTPS origin and a matching real session before any provider call", () => {
  const result = run(`
    import { mock } from "bun:test";
    let calls={chat:0,taste:0,search:0,voice:0,routes:0};
    const place={id:"synthetic-hosted-place",name:"Synthetic hosted fixture",description:"Synthetic provider contract fixture, not a live venue.",category:"culture",source:"qloo",lat:38.72,lng:-9.13,taste:{queryId:"synthetic-hosted-query",rank:7},practical:{hours:"unknown",cost:"unknown"}};
    mock.module("./src/server/providers.ts",()=>({getProviders:()=>({
      conversation:{reply:async()=>{calls.chat++;return{provider:"openai",message:"Synthetic authenticated reply"};}},
      taste:{recommend:async()=>{calls.taste++;return{provider:"qloo",queryId:"synthetic-hosted-query",places:[place]};},search:async()=>{calls.search++;return[];}},
      voice:{createSession:async()=>{calls.voice++;return{clientSecret:"synthetic-ephemeral",model:"synthetic-voice"};}}
    })}));
    globalThis.fetch=async()=>{calls.routes++;return Response.json({code:"Ok",routes:[{distance:1500,duration:250,legs:[{distance:1500,duration:250}],geometry:{type:"LineString",coordinates:[[-9.13,38.72],[-9.14,38.73]]}}]});};
    const {POST:accountPOST}=await import("./src/app/api/account/route.ts");
    const {POST:chat}=await import("./src/app/api/chat/route.ts");
    const {POST:taste}=await import("./src/app/api/taste/route.ts");
    const {POST:search}=await import("./src/app/api/taste/search/route.ts");
    const {POST:voice}=await import("./src/app/api/voice/session/route.ts");
    const {POST:routes}=await import("./src/app/api/routes/route.ts");
    const {GET:health}=await import("./src/app/api/health/route.ts");
    const {providerAvailable}=await import("./src/server/account-http.ts");
    const {getTripStore}=await import("./src/server/trip-store.ts");
    const origin="https://tastip.example", internal="http://localhost:3000";
    const req=(path,body,cookie,id,extra={},base=internal)=>new Request(base+"/api/"+path,{method:body?"POST":"GET",headers:{...(body?{Origin:origin,"Content-Type":"application/json"}:{Referer:origin+"/home"}),...(cookie?{cookie}:{}),...(id?{"X-Tastip-Account":id}:{}),...extra},...(body?{body:JSON.stringify(body)}:{})});
    async function register(username){const response=await accountPOST(req("account",{action:"register",username,password:"Synthetic-hosted-password-529"}));if(!response.ok)throw new Error("Fixture registration failed");return{account:(await response.json()).account,cookie:response.headers.get("Set-Cookie").split(";")[0]};}
    const alice=await register("hosted-alice"),bob=await register("hosted-bob");
    const body={message:"Synthetic open-ended request"};
    const anonymous=await chat(req("chat",body));
    const missingOwner=await chat(req("chat",body,alice.cookie));
    const wrongOwner=await chat(req("chat",body,bob.cookie,alice.account.id));
    const csrf=await chat(req("chat",body,alice.cookie,alice.account.id,{Origin:"https://elsewhere.example"}));
    const forwarded=await chat(req("chat",body,alice.cookie,alice.account.id,{Origin:"https://elsewhere.example","X-Forwarded-Host":"tastip.example","X-Forwarded-Proto":"https"}));
    const wrongUrl=await chat(req("chat",body,alice.cookie,alice.account.id,{},"https://elsewhere.example"));
    const publicHttp=await chat(req("chat",body,alice.cookie,alice.account.id,{},"http://tastip.example"));
    const crossSite=await chat(req("chat",body,alice.cookie,alice.account.id,{"Sec-Fetch-Site":"cross-site"}));
    const duplicateCookie=await chat(req("chat",body,alice.cookie+"; "+alice.cookie,alice.account.id));
    const before={...calls};
    const positive=[];
    positive.push((await chat(req("chat",body,alice.cookie,alice.account.id))).status);
    positive.push((await taste(req("taste",{entityIds:["00000000-0000-4000-8000-000000000068"],destinationId:"lisbon"},alice.cookie,alice.account.id))).status);
    positive.push((await search(req("taste/search",{query:"synthetic favorite"},alice.cookie,alice.account.id))).status);
    positive.push((await voice(req("voice/session",{},alice.cookie,alice.account.id))).status);
    positive.push((await routes(req("routes",{coordinates:[[-9.13,38.72],[-9.14,38.73]]},alice.cookie,alice.account.id))).status);
    const enabled=(await (await health(req("health",null,alice.cookie,alice.account.id))).json()).providers;
    const guest=(await (await health(req("health"))).json()).providers;
    const badReferer=providerAvailable(req("health",null,alice.cookie,alice.account.id,{Referer:"https://elsewhere.example/home"}));
    const spoofGet=providerAvailable(req("health",null,alice.cookie,alice.account.id,{Origin:"https://elsewhere.example",Referer:origin+"/home"}));
    delete process.env.TASTIP_ENABLE_HOSTED_PROVIDERS;
    const disabled=(await chat(req("chat",body,alice.cookie,alice.account.id))).status;
    const optedOut=(await (await health(req("health",null,alice.cookie,alice.account.id))).json()).providers;
    process.env.TASTIP_ENABLE_HOSTED_PROVIDERS="1";process.env.TASTIP_APP_ORIGIN="http://tastip.example";
    const insecureConfig=providerAvailable(req("health",null,alice.cookie,alice.account.id));
    console.log(JSON.stringify({anonymous:anonymous.status,missingOwner:missingOwner.status,wrongOwner:wrongOwner.status,csrf:csrf.status,forwarded:forwarded.status,wrongUrl:wrongUrl.status,publicHttp:publicHttp.status,crossSite:crossSite.status,duplicateCookie:duplicateCookie.status,before,positive,calls,enabled,guest,badReferer,spoofGet,disabled,optedOut,insecureConfig}));
    getTripStore().close();
  `);
  expect(result).toEqual({
    anonymous: 403,
    missingOwner: 409,
    wrongOwner: 409,
    csrf: 403,
    forwarded: 403,
    wrongUrl: 403,
    publicHttp: 403,
    crossSite: 403,
    duplicateCookie: 403,
    before: { chat: 0, taste: 0, search: 0, voice: 0, routes: 0 },
    positive: [200, 200, 200, 200, 200],
    calls: { chat: 1, taste: 1, search: 1, voice: 1, routes: 1 },
    enabled: { openai: true, qloo: true },
    guest: { openai: false, qloo: false },
    badReferer: false,
    spoofGet: false,
    disabled: 403,
    optedOut: { openai: false, qloo: false },
    insecureConfig: false,
  });
});

test("provider quotas are durable per-owner and globally bounded, and capability reads do not spend them", () => {
  const result = run(`
    import {assertProviderAccess,providerAvailable} from "./src/server/account-http.ts";
    import {getTripStore,TripStore} from "./src/server/trip-store.ts";
    import {openDatabase,databasePath} from "./src/server/database.ts";
    const store=getTripStore();
    const alice=await store.register("quota-alice","Synthetic-hosted-password-529"),bob=await store.register("quota-bob","Synthetic-hosted-password-529"),carol=await store.register("quota-carol","Synthetic-hosted-password-529");
    const req=(entry,extra={})=>new Request("http://127.0.0.1:3000/api/taste",{method:"POST",headers:{Origin:"https://tastip.example",cookie:"tastip_session="+entry.token,"X-Tastip-Account":entry.account.id,...extra}});
    const status=(work)=>{try{work();return 200;}catch(error){return error.status;}};
    process.env.TASTIP_DAILY_PROVIDER_LIMIT="1";
    const first=status(()=>assertProviderAccess(req(alice)));
    for(let i=0;i<50;i++)if(!providerAvailable(req(alice)))throw new Error("Expected authenticated availability");
    const db=openDatabase(databasePath());
    const readCount=(bucket)=>db.prepare("SELECT count FROM rate_buckets WHERE bucket=?").get(bucket)?.count;
    const afterHealth=readCount("provider:day:"+alice.account.id);
    const second=status(()=>assertProviderAccess(req(alice)));
    const reopened=new TripStore(openDatabase(databasePath()));
    const durable=status(()=>reopened.consume("provider:day:"+alice.account.id,1,86400000));
    process.env.TASTIP_DAILY_PROVIDER_LIMIT="10000";process.env.TASTIP_GLOBAL_PROVIDER_LIMIT="10000";
    let minuteAccepted=0;for(let i=0;i<30;i++)if(status(()=>assertProviderAccess(req(bob)))===200)minuteAccepted++;
    const minuteRejected=status(()=>assertProviderAccess(req(bob)));
    process.env.TASTIP_GLOBAL_PROVIDER_LIMIT="31";
    const globalRejected=status(()=>assertProviderAccess(req(carol)));
    const globalCount=readCount("provider:global:day");
    process.env.TASTIP_DAILY_PROVIDER_LIMIT="0";
    const invalidConfig=status(()=>assertProviderAccess(req(carol)));
    store.logout(alice.token);
    const revoked=status(()=>assertProviderAccess(req(alice)));
    console.log(JSON.stringify({first,afterHealth,second,durable,minuteAccepted,minuteRejected,globalRejected,globalCount,invalidConfig,revoked}));
    db.close();reopened.close();store.close();
  `);
  expect(result).toEqual({
    first: 200,
    afterHealth: 1,
    second: 429,
    durable: 429,
    minuteAccepted: 30,
    minuteRejected: 429,
    globalRejected: 429,
    globalCount: 31,
    invalidConfig: 500,
    revoked: 403,
  });
});

test("health gives hosted guests key-independent sign-in guidance without spending provider quotas", () => {
  const result = run(`
    import {GET} from "./src/app/api/health/route.ts";
    import {getTripStore} from "./src/server/trip-store.ts";
    import {openDatabase,databasePath} from "./src/server/database.ts";
    globalThis.fetch=async()=>{throw new Error("Health must not call an external provider");};
    const store=getTripStore();
    const alice=await store.register("health-guidance-alice","Synthetic-health-password-529");
    const request=(headers={},base="https://tastip.example")=>new Request(base+"/api/health",{headers:{Referer:"https://tastip.example/home",...headers}});
    const read=async(req)=>{const response=GET(req);return{status:response.status,cache:response.headers.get("Cache-Control"),body:await response.json()};};
    const canonical=await read(request());
    const normalized=await read(request({},"http://127.0.0.1:3000"));
    delete process.env.OPENAI_API_KEY;delete process.env.QLOO_API_KEY;
    const noKeys=await read(request());
    const authHeaders={cookie:"tastip_session="+alice.token,"X-Tastip-Account":alice.account.id};
    const authenticated=await read(request(authHeaders));
    const wrongOwner=await read(request({...authHeaders,"X-Tastip-Account":"another-owner"}));
    const wrongOrigin=await read(request({Origin:"https://elsewhere.example"}));
    const wrongReferer=await read(request({Referer:"https://elsewhere.example/home"}));
    const wrongUrl=await read(request({},"https://elsewhere.example"));
    const noBrowserOrigin=await read(new Request("https://tastip.example/api/health"));
    delete process.env.TASTIP_ENABLE_HOSTED_PROVIDERS;
    const optout=await read(request());
    process.env.TASTIP_ENABLE_HOSTED_PROVIDERS="1";process.env.TASTIP_APP_ORIGIN="http://tastip.example";
    const badConfig=await read(request());
    process.env.TASTIP_APP_ORIGIN="https://tastip.example";
    store.logout(alice.token);
    const expired=await read(request(authHeaders));
    process.env.NODE_ENV="development";
    const local=await read(request({},"http://localhost:3000"));
    const db=openDatabase(databasePath());
    const quotas=db.prepare("SELECT count(*) AS count FROM rate_buckets WHERE bucket LIKE 'provider:%'").get().count;
    console.log(JSON.stringify({canonical,normalized,noKeys,authenticated:authenticated.body.requiresSignIn,wrongOwner:wrongOwner.body.requiresSignIn,wrongOrigin:wrongOrigin.body.requiresSignIn,wrongReferer:wrongReferer.body.requiresSignIn,wrongUrl:wrongUrl.body.requiresSignIn,noBrowserOrigin:noBrowserOrigin.body.requiresSignIn,optout:optout.body.requiresSignIn,badConfig:badConfig.body.requiresSignIn,expired:expired.body.requiresSignIn,local:local.body.requiresSignIn,quotas}));
    db.close();store.close();
  `);
  const guest = {
    status: 200,
    cache: "no-store",
    body: { providers: { openai: false, qloo: false }, mode: "demo", requiresSignIn: true },
  };
  expect(result).toEqual({
    canonical: guest,
    normalized: guest,
    noKeys: guest,
    authenticated: false,
    wrongOwner: false,
    wrongOrigin: false,
    wrongReferer: false,
    wrongUrl: false,
    noBrowserOrigin: false,
    optout: false,
    badConfig: false,
    expired: true,
    local: false,
    quotas: 0,
  });
});

test("explicit internal origin admits the exact standalone bind URL while keeping browser origin, session and identity checks", () => {
  const result = run(`
    import {mock} from "bun:test";
    let providerCalls=0;
    mock.module("./src/server/providers.ts",()=>({getProviders:()=>({conversation:{reply:async()=>{providerCalls++;return{provider:"openai",message:"Synthetic standalone-origin reply"};}}})}));
    const {POST}=await import("./src/app/api/chat/route.ts");
    const {GET}=await import("./src/app/api/health/route.ts");
    const {assertProviderAccess}=await import("./src/server/account-http.ts");
    const {getTripStore}=await import("./src/server/trip-store.ts");
    const store=getTripStore();
    const alice=await store.register("internal-origin-alice","Synthetic-internal-origin-password-529");
    const publicOrigin="https://tastip.example",internal="https://0.0.0.0:3000";
    const request=(base=internal,extra={})=>new Request(base+"/api/chat",{method:"POST",headers:{Origin:publicOrigin,"Content-Type":"application/json",cookie:"tastip_session="+alice.token,"X-Tastip-Account":alice.account.id,...extra},body:JSON.stringify({message:"Synthetic standalone-origin request"})});
    const status=(work)=>{try{work();return 200;}catch(error){return error.status;}};
    delete process.env.TASTIP_INTERNAL_ORIGIN;
    const defaults=["https://0.0.0.0:3000","http://0.0.0.0:3000","https://localhost:3000","https://127.0.0.1:3000","https://[::1]:3000","http://[::]:3000"].map((base)=>status(()=>assertProviderAccess(request(base))));
    const forwardedWithoutSetting=status(()=>assertProviderAccess(request(internal,{"X-Forwarded-Host":"tastip.example","X-Forwarded-Proto":"https"})));
    process.env.TASTIP_INTERNAL_ORIGIN=internal;
    const authenticated=await POST(request());
    const exact={status:authenticated.status,reply:(await authenticated.json()).message};
    const wrongPort=status(()=>assertProviderAccess(request("https://0.0.0.0:3001")));
    const wrongProtocol=status(()=>assertProviderAccess(request("http://0.0.0.0:3000")));
    const otherSecureLoopback=status(()=>assertProviderAccess(request("https://127.0.0.1:3000")));
    const foreignOrigin=status(()=>assertProviderAccess(request(internal,{Origin:"https://elsewhere.example","X-Forwarded-Host":"tastip.example","X-Forwarded-Proto":"https"})));
    const crossSite=status(()=>assertProviderAccess(request(internal,{"Sec-Fetch-Site":"cross-site"})));
    const wrongOwner=status(()=>assertProviderAccess(request(internal,{"X-Tastip-Account":"another-owner"})));
    const noSession=status(()=>assertProviderAccess(request(internal,{cookie:""})));
    const guestHealth=await GET(new Request(internal+"/api/health",{headers:{Referer:publicOrigin+"/home","Sec-Fetch-Site":"same-origin"}})).json();
    const malformed=["not-an-origin","ftp://0.0.0.0:3000","https://elsewhere.example","https://0.0.0.0.evil:3000","https://user@0.0.0.0:3000","https://0.0.0.0:3000/","https://0.0.0.0:3000/path","https://0.0.0.0:3000?origin=trusted","https://0.0.0.0:3000#trusted"].map((origin)=>{process.env.TASTIP_INTERNAL_ORIGIN=origin;return status(()=>assertProviderAccess(request()));});
    const allowed=["http://localhost:3000","https://127.0.0.1:3000","https://[::1]:3000","http://[::]:3000","https://0.0.0.0:3000"].map((origin)=>{process.env.TASTIP_INTERNAL_ORIGIN=origin;return status(()=>assertProviderAccess(request(origin)));});
    process.env.TASTIP_INTERNAL_ORIGIN="invalid";
    const legacyHttpLoopback=status(()=>assertProviderAccess(request("http://127.0.0.1:3000")));
    console.log(JSON.stringify({defaults,forwardedWithoutSetting,exact,wrongPort,wrongProtocol,otherSecureLoopback,foreignOrigin,crossSite,wrongOwner,noSession,guestHealth,malformed,allowed,legacyHttpLoopback,providerCalls}));
    store.close();
  `);
  expect(result).toEqual({
    defaults: [403, 403, 403, 403, 403, 403],
    forwardedWithoutSetting: 403,
    exact: { status: 200, reply: "Synthetic standalone-origin reply" },
    wrongPort: 403,
    wrongProtocol: 403,
    otherSecureLoopback: 403,
    foreignOrigin: 403,
    crossSite: 403,
    wrongOwner: 409,
    noSession: 403,
    guestHealth: { providers: { openai: false, qloo: false }, mode: "demo", requiresSignIn: true },
    malformed: [403, 403, 403, 403, 403, 403, 403, 403, 403],
    allowed: [200, 200, 200, 200, 200],
    legacyHttpLoopback: 200,
    providerCalls: 1,
  });
});
