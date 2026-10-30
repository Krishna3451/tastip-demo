import { type Conversation, parseConversations } from "./conversations";

export type ConversationBackup = {
  conversations: Conversation[] | null;
  revision: number;
  updatedAt: number | null;
};

/** Pending composer requests belong to their original device, never a restored session. */
export function backupConversations(items: Conversation[]) {
  return items.map(({ pendingMessage: _pending, ...item }) => item);
}

/** Keep both versions of divergent chats rather than choosing by a device's clock. */
export function mergeConversationBackup(
  local: Conversation[],
  incoming: Conversation[],
  newId: () => string = () => crypto.randomUUID(),
): Conversation[] | null {
  const result = parseConversations(JSON.stringify(local));
  const parsedIncoming = parseConversations(JSON.stringify(incoming));
  if (!result || !parsedIncoming) return null;
  for (const item of backupConversations(parsedIncoming)) {
    const existing = result.find((candidate) => candidate.id === item.id);
    if (!existing) result.push(item);
    else if (JSON.stringify(backupConversations([existing])[0]) !== JSON.stringify(item)) {
      // A previous restore of this same version must not create another duplicate.
      const { id: _id, ...content } = item;
      if (
        result.some(
          ({ id: _candidateId, ...candidate }) =>
            JSON.stringify(candidate) === JSON.stringify(content),
        )
      )
        continue;
      result.push({ ...item, id: newId() });
    }
  }
  return parseConversations(JSON.stringify(result));
}

export function parseConversationBackup(value: unknown): ConversationBackup | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as ConversationBackup;
  if (
    !Number.isSafeInteger(candidate.revision) ||
    candidate.revision < 0 ||
    (candidate.updatedAt !== null &&
      (!Number.isSafeInteger(candidate.updatedAt) || candidate.updatedAt < 0))
  )
    return null;
  const conversations =
    candidate.conversations === null
      ? null
      : parseConversations(JSON.stringify(candidate.conversations) ?? "");
  if (conversations === null && candidate.conversations !== null) return null;
  return { conversations, revision: candidate.revision, updatedAt: candidate.updatedAt };
}
