import { z } from "zod";
import { assertProviderAccess } from "@/server/account-http";
import { json, readJson, routeError } from "@/server/http";
import { getProviders } from "@/server/providers";

export const runtime = "nodejs";
const schema = z.object({ query: z.string().trim().min(2).max(200) });

export async function POST(request: Request) {
  try {
    const body = await readJson(request, schema);
    assertProviderAccess(request);
    return json({
      provider: "qloo",
      results: await getProviders().taste.search(body.query, request.signal),
    });
  } catch (error) {
    return routeError(error);
  }
}
