import type { ConversationReply } from "@tastip/providers";
import { proposalShape } from "./conversations";

function checkedReply(value: unknown): ConversationReply {
  if (!value || typeof value !== "object")
    throw new Error("The assistant returned an unreadable reply. Try again.");
  const reply = value as ConversationReply;
  if (
    typeof reply.message !== "string" ||
    reply.message.length > 20000 ||
    !["openai", "local"].includes(reply.provider) ||
    (reply.proposal !== undefined && !proposalShape(reply.proposal))
  )
    throw new Error("The assistant returned an unreadable reply. Your trip is unchanged.");
  return reply;
}

/** Partial text is transient. Only a complete, validated reply may enter chat history. */
export async function readChatReply(
  response: Response,
  onText: (text: string) => void,
): Promise<ConversationReply> {
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.error?.message === "string"
        ? body.error.message
        : "The assistant could not respond. Try again.",
    );
  }
  if (!response.headers.get("content-type")?.includes("application/x-ndjson"))
    return checkedReply(await response.json());
  if (!response.body) throw new Error("The reply connection did not open. Try again.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffered = "";
  let bytes = 0;
  let previous = "";
  let completed: ConversationReply | undefined;
  function line(value: string) {
    if (!value.trim()) return;
    if (completed) throw new Error("The assistant returned an unexpected reply. Try again.");
    let item: unknown;
    try {
      item = JSON.parse(value);
    } catch {
      throw new Error("The reply was interrupted. Try again.");
    }
    if (!item || typeof item !== "object")
      throw new Error("The reply could not be read. Try again.");
    const event = item as { type?: string; text?: string; reply?: unknown; message?: string };
    if (
      event.type === "text" &&
      typeof event.text === "string" &&
      event.text.length <= 20000 &&
      event.text.startsWith(previous)
    ) {
      previous = event.text;
      onText(event.text);
    } else if (event.type === "complete") completed = checkedReply(event.reply);
    else if (event.type === "error")
      throw new Error(
        typeof event.message === "string"
          ? event.message.slice(0, 1000)
          : "The reply was interrupted. Try again.",
      );
    else throw new Error("The reply could not be read. Try again.");
  }
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_000_000) throw new Error("The reply was too long. Try a shorter question.");
      buffered += decoder.decode(part.value, { stream: true });
      let end = buffered.indexOf("\n");
      while (end >= 0) {
        line(buffered.slice(0, end));
        buffered = buffered.slice(end + 1);
        end = buffered.indexOf("\n");
      }
    }
    buffered += decoder.decode();
    if (buffered.trim()) line(buffered);
    if (!completed) throw new Error("The reply was interrupted before it finished. Try again.");
    return completed;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
