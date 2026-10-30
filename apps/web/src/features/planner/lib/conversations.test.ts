import { describe, expect, test } from "bun:test";
import { type Conversation, parseConversations, updateConversationMessages } from "./conversations";

const chat: Conversation = { id: "chat-1", title: "Untitled", updatedAt: 1, messages: [] };
describe("scoped conversation storage", () => {
  test("restores history, archived records and accepted proposal state without applying commands", () => {
    const conversations: Conversation[] = [
      {
        ...chat,
        archived: true,
        messages: [
          {
            id: "message-1",
            role: "assistant",
            text: "Here is an edit",
            state: "applied",
            acceptedVersion: 2,
            proposal: {
              id: "proposal-1",
              tripId: "trip-1",
              baseVersion: 1,
              summary: "Keep this visit",
              operations: [{ type: "pin-stop", stopId: "stop-1", pinned: true }],
            },
          },
        ],
      },
    ];
    expect(parseConversations(JSON.stringify(conversations))).toEqual(conversations);
  });
  test("rejects damaged, oversized, duplicate and malformed proposal caches", () => {
    expect(parseConversations("{")).toBeNull();
    expect(parseConversations(JSON.stringify([chat, chat]))).toBeNull();
    expect(parseConversations(" ".repeat(4_000_001))).toBeNull();
    expect(
      parseConversations(
        JSON.stringify([{ ...chat, messages: [{ id: "bad", role: "system", text: "bad" }] }]),
      ),
    ).toBeNull();
    expect(
      parseConversations(
        JSON.stringify([
          {
            ...chat,
            messages: [{ id: "bad", role: "assistant", text: "bad", proposal: { operations: [] } }],
          },
        ]),
      ),
    ).toBeNull();
  });
  test("names a chat from its first request, keeps manual names and bounds history", () => {
    const messages = [{ id: "m1", role: "user" as const, text: "Lisbon\n in March" }];
    expect(updateConversationMessages([chat], chat.id, messages, 2)[0]?.title).toBe(
      "Lisbon in March",
    );
    expect(
      updateConversationMessages(
        [{ ...chat, title: "Portugal", renamed: true }],
        chat.id,
        messages,
        2,
      )[0]?.title,
    ).toBe("Portugal");
    expect(
      updateConversationMessages(
        [chat],
        chat.id,
        Array.from({ length: 101 }, (_, index) => ({ ...messages[0]!, id: `m${index}` })),
        3,
      )[0]?.messages,
    ).toHaveLength(100);
    expect(updateConversationMessages([chat], "another-chat", messages, 2)).toEqual([chat]);
  });
});
