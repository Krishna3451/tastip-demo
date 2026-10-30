import { z } from "zod";
import { requireAccount } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
import { getTripStore } from "@/server/trip-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    trip: z.unknown(),
    expectedRevision: z.number().int().positive().nullable(),
  }),
  z.object({
    action: z.literal("share"),
    id: z.string().min(1).max(150),
    expectedRevision: z.number().int().positive(),
  }),
  z.object({ action: z.literal("revoke"), token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
]);
export async function GET(request: Request) {
  try {
    const account = requireAccount(request);
    const params = new URL(request.url).searchParams;
    const id = params.get("id");
    const shares = params.get("shares");
    if ((id && id.length > 150) || (shares && shares.length > 150) || (id && shares))
      return json(
        { error: { code: "INVALID_INPUT", message: "Choose one saved trip or its share links." } },
        400,
      );
    const store = getTripStore();
    return json(
      shares
        ? { shares: store.shares(account.id, shares) }
        : id
          ? store.read(account.id, id)
          : { trips: store.list(account.id) },
    );
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    const account = requireAccount(request);
    const body = await readJson(request, schema, { maxBytes: 5 * 1024 * 1024 });
    const store = getTripStore();
    store.consume(`trip-writes:${account.id}`, 60, 60000);
    if (body.action === "save")
      return json(store.save(account.id, body.trip, body.expectedRevision));
    if (body.action === "share")
      return json(store.share(account.id, body.id, body.expectedRevision));
    store.revoke(account.id, body.token);
    return json({ revoked: true });
  } catch (error) {
    return routeError(error);
  }
}
