import { z } from "zod";
import { requireAccount } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
import { getTripStore } from "@/server/trip-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("save"),
    conversations: z.array(z.unknown()).max(50),
    expectedRevision: z.number().int().nonnegative(),
  }),
  z.object({ action: z.literal("clear"), expectedRevision: z.number().int().nonnegative() }),
]);

export async function GET(request: Request) {
  try {
    const account = requireAccount(request);
    return json(getTripStore().conversationBackup(account.id));
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    const account = requireAccount(request);
    const body = await readJson(request, schema, { maxBytes: 5 * 1024 * 1024 });
    const store = getTripStore();
    store.consume(`chat-backup-writes:${account.id}`, 20, 60_000);
    return json(
      store.saveConversationBackup(
        account.id,
        body.action === "save" ? body.conversations : null,
        body.expectedRevision,
      ),
    );
  } catch (error) {
    return routeError(error);
  }
}
