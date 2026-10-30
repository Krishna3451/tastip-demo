import { z } from "zod";
import { requestAccount, sessionToken, setSessionCookie } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
import { getTripStore } from "@/server/trip-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.enum(["register", "login"]),
    username: z.string().trim().min(3).max(32),
    password: z.string().min(10).max(128),
  }),
  z.object({ action: z.literal("logout") }),
]);
export async function GET(request: Request) {
  try {
    return json({ account: requestAccount(request) });
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    const body = await readJson(request, schema);
    const store = getTripStore();
    if (body.action === "logout") {
      store.logout(sessionToken(request));
      return setSessionCookie(json({ account: null }), "", request, true);
    }
    const result =
      body.action === "register"
        ? await store.register(body.username, body.password)
        : await store.login(body.username, body.password);
    return setSessionCookie(json({ account: result.account }), result.token, request);
  } catch (error) {
    return routeError(error);
  }
}
