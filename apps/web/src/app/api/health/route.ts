import { providerAvailable, providerRequiresSignIn } from "@/server/account-http";
import { json, routeError } from "@/server/http";

export const dynamic = "force-dynamic";

export function GET(request: Request) {
  try {
    const enabled = providerAvailable(request);
    const providers = {
      openai: enabled && Boolean(process.env.OPENAI_API_KEY),
      qloo: enabled && Boolean(process.env.QLOO_API_KEY),
    };
    return json({
      providers,
      mode: providers.openai && providers.qloo ? "configured" : "demo",
      requiresSignIn: providerRequiresSignIn(request),
    });
  } catch (error) {
    return routeError(error);
  }
}
