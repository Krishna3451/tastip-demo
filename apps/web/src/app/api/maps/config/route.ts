import { json, routeError } from "@/server/http";
import { mapsConfiguration } from "@/server/maps-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: Request) {
  try {
    return json(mapsConfiguration(request));
  } catch (error) {
    return routeError(error);
  }
}
