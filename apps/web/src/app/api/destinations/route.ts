import { z } from "zod";
import { findDestinations } from "@/server/destinations";
import { json, readJson, routeError } from "@/server/http";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const body = await readJson(request, z.object({ query: z.string().trim().min(2).max(100) }));
    return json({
      results: await findDestinations(body.query, request.signal),
      source: "open-meteo",
    });
  } catch (error) {
    return routeError(error);
  }
}
