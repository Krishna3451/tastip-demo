import { parseTasteProfile, type TasteProfile } from "@tastip/domain";
import { z } from "zod";
import { requireAccount } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
import { getTripStore } from "@/server/trip-store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    profile: z.custom<TasteProfile>((value) => parseTasteProfile(value) !== null),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal("forget"), expectedRevision: z.number().int().nonnegative() }),
]);
export async function GET(request: Request) {
  try {
    const account = requireAccount(request);
    return json(getTripStore().tasteProfile(account.id));
  } catch (error) {
    return routeError(error);
  }
}
export async function POST(request: Request) {
  try {
    const account = requireAccount(request);
    const body = await readJson(request, schema, { maxBytes: 16 * 1024 });
    const store = getTripStore();
    store.consume(`profile-writes:${account.id}`, 30, 60_000);
    return json(
      store.saveTasteProfile(
        account.id,
        body.action === "save" ? body.profile : null,
        body.expectedRevision,
      ),
    );
  } catch (error) {
    return routeError(error);
  }
}
