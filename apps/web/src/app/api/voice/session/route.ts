import { assistantPreferencesSchema } from "@tastip/providers";
import { z } from "zod";
import { assertProviderAccess } from "@/server/account-http";
import { toProviderContext, tripContextSchema } from "@/server/context";
import { json, readJson, routeError } from "@/server/http";
import { getProviders } from "@/server/providers";

export const runtime = "nodejs";
export const maxDuration = 40;
const schema = z.object({
  trip: tripContextSchema.optional(),
  preferences: assistantPreferencesSchema.optional(),
});

export async function POST(request: Request) {
  try {
    const body = await readJson(request, schema);
    assertProviderAccess(request);
    return json(
      await getProviders().voice.createSession(
        toProviderContext(body.trip),
        request.signal,
        body.preferences,
      ),
    );
  } catch (error) {
    return routeError(error);
  }
}
