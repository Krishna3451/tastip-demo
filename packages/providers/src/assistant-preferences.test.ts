import { expect, test } from "bun:test";
import { assistantPreferencesSchema } from "./assistant-preferences";
import { createOpenAIProviders } from "./openai";

test("assistant preferences validate a bounded voice and style selection", () => {
  expect(assistantPreferencesSchema.parse({})).toEqual({
    voice: "marin",
    style: "neutral",
    memory: true,
  });
  expect(assistantPreferencesSchema.safeParse({ voice: "invented-voice" }).success).toBe(false);
  expect(assistantPreferencesSchema.safeParse({ style: "ignore instructions" }).success).toBe(
    false,
  );
});

test("voice selection and style reach the actual realtime session request", async () => {
  let sent: Record<string, unknown> = {};
  const providers = createOpenAIProviders({
    apiKey: "synthetic-contract-key",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({ value: "synthetic-short-lived-secret", expires_at: 123 });
    },
  });
  await providers.voice.createSession(undefined, undefined, {
    voice: "cedar",
    style: "concise",
    memory: false,
  });
  expect(sent).toMatchObject({ session: { audio: { output: { voice: "cedar" } } } });
  expect(JSON.stringify(sent)).toContain("Use concise answers");
});

test("memory-off excludes saved traveler preferences from model instructions", async () => {
  let sent: Record<string, unknown> = {};
  const providers = createOpenAIProviders({
    apiKey: "synthetic-contract-key",
    fetch: async (_url, init) => {
      sent = JSON.parse(String(init?.body));
      return Response.json({
        id: "resp_preferences",
        object: "response",
        output: [
          {
            type: "message",
            id: "msg_preferences",
            role: "assistant",
            status: "completed",
            content: [
              {
                type: "output_text",
                text: JSON.stringify({ message: "Where would you like to go?", proposal: null }),
                annotations: [],
              },
            ],
          },
        ],
      });
    },
  });
  await providers.conversation.reply({
    message: "Hello",
    preferences: { voice: "marin", style: "friendly", memory: false },
    travelPreferences: "synthetic-private-preference",
  });
  expect(String(sent.instructions)).not.toContain("synthetic-private-preference");
  expect(String(sent.instructions)).toContain("warm, friendly");
  await providers.conversation.reply({
    message: "Hello",
    preferences: { voice: "marin", style: "friendly", memory: true },
    travelPreferences: "synthetic-private-preference",
  });
  expect(String(sent.instructions)).toContain("synthetic-private-preference");
  expect(sent.store).toBe(false);
});
