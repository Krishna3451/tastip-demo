import { z } from "zod";

export const assistantPreferencesSchema = z.object({
  voice: z.enum(["marin", "shimmer", "echo", "cedar"]).default("marin"),
  style: z.enum(["neutral", "concise", "friendly", "detailed"]).default("neutral"),
  memory: z.boolean().default(true),
});
export type AssistantPreferences = z.infer<typeof assistantPreferencesSchema>;
export const DEFAULT_ASSISTANT_PREFERENCES: AssistantPreferences = {
  voice: "marin",
  style: "neutral",
  memory: true,
};

export function preferenceInstructions(preferences?: AssistantPreferences): string {
  const styles = {
    neutral: "Use a balanced, neutral communication style.",
    concise: "Use concise answers, focusing on the information the traveler needs next.",
    friendly: "Use a warm, friendly communication style without excessive praise.",
    detailed: "Give detailed explanations when useful, with clear, practical travel context.",
  };
  return styles[preferences?.style ?? "neutral"];
}
