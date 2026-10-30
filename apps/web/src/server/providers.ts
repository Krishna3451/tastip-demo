import "server-only";
import { createOpenAIProviders, createQlooProvider } from "@tastip/providers";

/** Lazy construction keeps the sample itinerary usable without credentials. */
export function getProviders() {
  return {
    ...createOpenAIProviders({
      apiKey: process.env.OPENAI_API_KEY,
      chatModel: process.env.OPENAI_CHAT_MODEL,
      voiceModel: process.env.OPENAI_REALTIME_MODEL,
    }),
    taste: createQlooProvider({ apiKey: process.env.QLOO_API_KEY }),
  };
}
