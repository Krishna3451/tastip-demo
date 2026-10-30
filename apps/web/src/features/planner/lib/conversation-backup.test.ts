import { expect, test } from "bun:test";
import {
  backupConversations,
  mergeConversationBackup,
  parseConversationBackup,
} from "./conversation-backup";
import type { Conversation } from "./conversations";

const chat = (id = "chat-1", text = "Plan a trip"): Conversation => ({
  id,
  title: "Private chat",
  updatedAt: 100,
  tripId: "trip-private",
  pendingMessage: "Unsent request",
  messages: [{ id: "message-1", role: "user", text }],
});

test("restoring chats keeps local divergent versions, strips incoming pending requests and is repeatable", () => {
  const local = chat();
  const remote = chat("chat-1", "Different private history");
  const merged = mergeConversationBackup(
    [local],
    [remote, chat("chat-2")],
    () => "restored-version",
  );
  expect(merged).toHaveLength(3);
  expect(merged?.[0]).toEqual(local);
  expect(merged?.[1]).toMatchObject({ id: "restored-version", messages: remote.messages });
  expect(merged?.[1]?.pendingMessage).toBeUndefined();
  expect(merged?.[2]?.pendingMessage).toBeUndefined();
  expect(mergeConversationBackup(merged ?? [], [remote, chat("chat-2")])).toEqual(merged);
  expect(local.pendingMessage).toBe("Unsent request");
  // Property insertion order and a pending composer draft cannot create false conflicts.
  expect(mergeConversationBackup([local], backupConversations([local]))).toEqual([local]);
});

test("restores reject exceeding local limits, while revision envelopes fail closed", () => {
  const local = Array.from({ length: 50 }, (_, i) => chat(`chat-${i}`));
  expect(mergeConversationBackup(local, [chat("another-chat")])).toBeNull();
  expect(local).toHaveLength(50);
  expect(parseConversationBackup({ conversations: null, revision: 2, updatedAt: 100 })).toEqual({
    conversations: null,
    revision: 2,
    updatedAt: 100,
  });
  for (const invalid of [
    { conversations: [], revision: -1, updatedAt: null },
    { conversations: [], revision: 1.5, updatedAt: null },
    { conversations: [], revision: 1 },
    { conversations: [chat(), chat()], revision: 1, updatedAt: 100 },
    { revision: 1, updatedAt: 100 },
  ])
    expect(parseConversationBackup(invalid)).toBeNull();
});
