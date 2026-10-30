import type { ChatProposal } from "@tastip/providers";
import { z } from "zod";

export type ConversationMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  proposal?: ChatProposal;
  state?: "applied" | "dismissed";
  acceptedVersion?: number;
  edits?: string[];
};
export type Conversation = {
  id: string;
  title: string;
  renamed?: boolean;
  tripId?: string;
  updatedAt: number;
  archived?: boolean;
  pendingMessage?: string;
  messages: ConversationMessage[];
};

export function proposalShape(value: unknown): value is ChatProposal {
  if (!value || typeof value !== "object") return false;
  const proposal = value as ChatProposal;
  return (
    typeof proposal.id === "string" &&
    proposal.id.length <= 160 &&
    typeof proposal.tripId === "string" &&
    proposal.tripId.length <= 160 &&
    Number.isInteger(proposal.baseVersion) &&
    proposal.baseVersion >= 0 &&
    typeof proposal.summary === "string" &&
    proposal.summary.length <= 4000 &&
    Array.isArray(proposal.operations) &&
    proposal.operations.length > 0 &&
    proposal.operations.length <= 8 &&
    proposal.operations.every(
      (operation) =>
        operation !== null &&
        typeof operation === "object" &&
        "stopId" in operation &&
        typeof operation.stopId === "string" &&
        [
          "set-start-time",
          "set-duration",
          "move-stop",
          "pin-stop",
          "lock-time",
          "remove-stop",
          "replace-stop",
          "rate-stop",
        ].includes(operation.type),
    )
  );
}

const messageSchema = z.object({
  id: z.string().min(1).max(160),
  role: z.enum(["user", "assistant"]),
  text: z.string().max(20000),
  proposal: z.custom<ChatProposal>(proposalShape).optional(),
  state: z.enum(["applied", "dismissed"]).optional(),
  acceptedVersion: z.number().int().nonnegative().optional(),
  edits: z.array(z.string().max(2000)).max(8).optional(),
});
const conversationSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9-]{1,80}$/),
  title: z.string().trim().min(1).max(160),
  renamed: z.boolean().optional(),
  tripId: z.string().max(160).optional(),
  updatedAt: z.number().int().nonnegative(),
  archived: z.boolean().optional(),
  pendingMessage: z.string().max(4000).optional(),
  messages: z.array(messageSchema).max(100),
});

/** Reject a damaged cache as a whole so subsequent writes cannot erase recoverable records. */
export function parseConversations(raw: string): Conversation[] | null {
  if (raw.length > 4_000_000) return null;
  try {
    const parsed = z.array(conversationSchema).max(50).safeParse(JSON.parse(raw));
    if (!parsed.success || new Set(parsed.data.map((item) => item.id)).size !== parsed.data.length)
      return null;
    return parsed.data;
  } catch {
    return null;
  }
}

export function updateConversationMessages(
  conversations: Conversation[],
  id: string,
  messages: ConversationMessage[],
  now: number,
): Conversation[] {
  return conversations.map((conversation) => {
    if (conversation.id !== id) return conversation;
    const first = messages.find((message) => message.role === "user")?.text;
    return {
      ...conversation,
      title:
        conversation.renamed || !first
          ? conversation.title
          : first.replace(/\s+/g, " ").slice(0, 160),
      updatedAt: now,
      messages: messages.slice(-100),
    };
  });
}
