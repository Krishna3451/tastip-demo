import { ProviderError } from "@tastip/providers";
import type { z } from "zod";
import { ServiceError } from "./service-error";

const MAX_BODY_BYTES = 64 * 1024;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };

export class RequestError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}

export function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers });
}

export function routeError(error: unknown) {
  if (error instanceof ServiceError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof RequestError)
    return json({ error: { code: error.code, message: error.message } }, error.status);
  if (error instanceof ProviderError)
    return json(
      { error: { code: error.code, message: error.message } },
      error.code === "INVALID_TASTE_QUERY" ? 400 : 503,
    );
  return json(
    {
      error: {
        code: "REQUEST_FAILED",
        message: "The request could not be completed. Please try again.",
      },
    },
    500,
  );
}

export async function readJson<T>(
  request: Request,
  schema: z.ZodType<T>,
  options?: { maxBytes: number },
): Promise<T> {
  const maxBodyBytes = Math.min(options?.maxBytes ?? MAX_BODY_BYTES, 5 * 1024 * 1024);
  const origin = request.headers.get("origin");
  const requestUrl = new URL(request.url);
  let sameOrigin =
    process.env.NODE_ENV === "production" && process.env.TASTIP_APP_ORIGIN
      ? origin === process.env.TASTIP_APP_ORIGIN
      : origin === requestUrl.origin;
  // Next dev normalizes Request.url to localhost even when served on 127.0.0.1.
  // Accept only equivalent loopback origins on the same port during development.
  if (!sameOrigin && origin && localIntegrationEnabled(request)) {
    try {
      const incoming = new URL(origin);
      sameOrigin =
        ["localhost", "127.0.0.1", "[::1]"].includes(incoming.hostname) &&
        incoming.protocol === requestUrl.protocol &&
        incoming.port === requestUrl.port;
    } catch {
      sameOrigin = false;
    }
  }
  if (!origin || !sameOrigin)
    throw new RequestError("INVALID_ORIGIN", "This request must come from the Tastip app.", 403);
  if (!request.headers.get("content-type")?.includes("application/json"))
    throw new RequestError("INVALID_CONTENT_TYPE", "Send a JSON request.", 415);
  if (Number(request.headers.get("content-length") || 0) > maxBodyBytes)
    throw new RequestError("BODY_TOO_LARGE", "This request is too large.", 413);
  if (!request.body) throw new RequestError("INVALID_BODY", "A request body is required.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBodyBytes) {
      await reader.cancel();
      throw new RequestError("BODY_TOO_LARGE", "This request is too large.", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new RequestError("INVALID_JSON", "The request is not valid JSON.");
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new RequestError("INVALID_INPUT", "Some request details are missing or invalid.");
  return parsed.data;
}

export function localIntegrationEnabled(request: Request, environment = process.env.NODE_ENV) {
  const hostname = new URL(request.url).hostname;
  return environment !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(hostname);
}

export function assertLocalIntegrationEnabled(request: Request) {
  // Paid routes are restricted to loopback development until server-owned identities
  // and durable abuse controls are implemented. A public deployment stays sample-only.
  if (!localIntegrationEnabled(request)) {
    throw new RequestError(
      "LOCAL_INTEGRATION_ONLY",
      "Live AI is available in local development. This preview uses sample trips.",
      503,
    );
  }
}
