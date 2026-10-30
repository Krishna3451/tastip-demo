import { assistantPreferencesSchema, localEditReply, ProviderError } from "@tastip/providers";
import { z } from "zod";
import { assertProviderAccess } from "@/server/account-http";
import { toProviderContext, tripContextSchema } from "@/server/context";
import { json, readJson, routeError } from "@/server/http";
import { getProviders } from "@/server/providers";

export const runtime = "nodejs";
export const maxDuration = 40;
const schema = z.object({
  message: z.string().trim().min(1).max(4000),
  history: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) }))
    .max(12)
    .optional(),
  trip: tripContextSchema.optional(),
  preferences: assistantPreferencesSchema.optional(),
  travelPreferences: z.string().max(4000).optional(),
  stream: z.boolean().optional(),
});

export async function POST(request: Request) {
  try {
    const body = await readJson(request, schema);
    const context = toProviderContext(body.trip);
    const localReply = localEditReply(body.message, context);
    if (localReply) return json(localReply);
    assertProviderAccess(request);
    const input = {
      message: body.message,
      history: body.history,
      preferences: body.preferences,
      travelPreferences: body.preferences?.memory === false ? undefined : body.travelPreferences,
      context,
    };
    if (!body.stream)
      return json(await getProviders().conversation.reply({ ...input, signal: request.signal }));

    const encoder = new TextEncoder();
    const upstream = new AbortController();
    const abort = () => upstream.abort();
    request.signal.addEventListener("abort", abort, { once: true });
    if (request.signal.aborted) abort();
    let closed = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        function emit(value: unknown) {
          if (!closed && !upstream.signal.aborted)
            controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`));
        }
        try {
          const reply = await getProviders().conversation.reply({
            ...input,
            signal: upstream.signal,
            onText: (text) => emit({ type: "text", text }),
          });
          emit({ type: "complete", reply });
        } catch (error) {
          if (!upstream.signal.aborted)
            emit({
              type: "error",
              message:
                error instanceof ProviderError
                  ? error.message
                  : "The assistant could not finish its reply. Your trip is unchanged; please try again.",
            });
        } finally {
          request.signal.removeEventListener("abort", abort);
          if (!closed) {
            closed = true;
            controller.close();
          }
        }
      },
      cancel() {
        closed = true;
        upstream.abort();
        request.signal.removeEventListener("abort", abort);
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
