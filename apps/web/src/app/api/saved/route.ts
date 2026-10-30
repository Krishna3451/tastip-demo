import { z } from "zod";
import { requireAccount } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
import { getSavedStore } from "@/server/saved-store";
import { getTripStore } from "@/server/trip-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    workspace: z.unknown(),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal("clear"), expectedRevision: z.number().int().nonnegative() }),
]);

export async function GET(request: Request) {
  try {
    const account = requireAccount(request);
    return json(getSavedStore().get(account.id));
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    const account = requireAccount(request);
    const body = await readJson(request, schema, { maxBytes: 4_100_000 });
    getTripStore().consume(`saved-workspace-writes:${account.id}`, 20, 60_000);
    const store = getSavedStore();
    return json(
      body.action === "save"
        ? store.save(account.id, body.workspace, body.expectedRevision)
        : store.clear(account.id, body.expectedRevision),
    );
  } catch (error) {
    return routeError(error);
  }
}
