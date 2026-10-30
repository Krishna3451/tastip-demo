"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { mergeConversationBackup } from "../planner/lib/conversation-backup";
import {
  type Conversation,
  type ConversationMessage,
  parseConversations,
  updateConversationMessages,
} from "../planner/lib/conversations";

export function useConversations(scope: string, ready: boolean) {
  const key = `tastip.reference.chats:${scope}`;
  const [items, setItems] = useState<Conversation[]>([]);
  const [loadedKey, setLoadedKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const current = useRef({ key: "", items: [] as Conversation[], writable: false });
  useEffect(() => {
    if (!ready) return;
    let restored: Conversation[] | null = null;
    try {
      restored = parseConversations(localStorage.getItem(key) ?? "[]");
    } catch {
      /* Read failure blocks writes. */
    }
    current.current = { key, items: restored ?? [], writable: restored !== null };
    setItems(restored ?? []);
    setLoadedKey(key);
    setError(
      restored ? null : "Your chat history could not be read. The saved copy has been kept.",
    );
  }, [key, ready]);
  const persist = useCallback(
    (next: Conversation[]) => {
      if (current.current.key !== key || !current.current.writable) return false;
      const serialized = JSON.stringify(next);
      if (!parseConversations(serialized)) {
        setError("Chat storage is full. This device supports 50 chats and 100 messages per chat.");
        return false;
      }
      try {
        localStorage.setItem(key, serialized);
        current.current.items = next;
        setItems(next);
        setError(null);
        return true;
      } catch {
        setError("Your browser could not save this chat. Keep this page open and try again.");
        return false;
      }
    },
    [key],
  );
  const create = useCallback(
    (tripId?: string, pendingMessage?: string) => {
      if (current.current.key !== key || !current.current.writable) return null;
      const conversation: Conversation = {
        id: crypto.randomUUID(),
        title: "Untitled",
        updatedAt: Date.now(),
        messages: [],
        ...(tripId ? { tripId } : {}),
        ...(pendingMessage ? { pendingMessage } : {}),
      };
      return persist([conversation, ...current.current.items]) ? conversation : null;
    },
    [key, persist],
  );
  const updateMessages = useCallback(
    (id: string, messages: ConversationMessage[]) => {
      if (current.current.key !== key) return;
      const previous = current.current.items.find((item) => item.id === id);
      if (!previous || JSON.stringify(previous.messages) === JSON.stringify(messages)) return;
      persist(updateConversationMessages(current.current.items, id, messages, Date.now()));
    },
    [key, persist],
  );
  const consumePending = useCallback(
    (id: string) =>
      persist(
        current.current.items.map((item) =>
          item.id === id ? { ...item, pendingMessage: undefined } : item,
        ),
      ),
    [persist],
  );
  const rename = useCallback(
    (id: string, title: string) =>
      persist(
        current.current.items.map((item) =>
          item.id === id ? { ...item, title: title.trim().slice(0, 160), renamed: true } : item,
        ),
      ),
    [persist],
  );
  const archive = useCallback(
    (id: string, archived: boolean) =>
      persist(current.current.items.map((item) => (item.id === id ? { ...item, archived } : item))),
    [persist],
  );
  const associateTrip = useCallback(
    (id: string, tripId: string) => {
      if (
        current.current.key !== key ||
        !current.current.writable ||
        !current.current.items.some((item) => item.id === id)
      )
        return false;
      return persist(
        current.current.items.map((item) =>
          item.id === id ? { ...item, tripId, updatedAt: Date.now() } : item,
        ),
      );
    },
    [key, persist],
  );
  const restoreBackup = useCallback(
    (incoming: Conversation[], expectedLocal: string) => {
      if (current.current.key !== key || !current.current.writable) return false;
      try {
        const stored = parseConversations(localStorage.getItem(key) ?? "[]");
        if (
          JSON.stringify(current.current.items) !== expectedLocal ||
          !stored ||
          JSON.stringify(stored) !== JSON.stringify(parseConversations(expectedLocal))
        ) {
          setError("Your device's chats changed. Refresh this page and review the backup again.");
          return false;
        }
      } catch {
        setError("Your browser could not read its saved chats. The backup has not been restored.");
        return false;
      }
      const merged = mergeConversationBackup(current.current.items, incoming);
      if (!merged) {
        setError(
          "Both histories exceed this device's chat limit. Existing chats and the account backup have been kept.",
        );
        return false;
      }
      return persist(merged);
    },
    [key, persist],
  );
  return {
    items: loadedKey === key ? items : [],
    ready: ready && loadedKey === key,
    writable: ready && loadedKey === key && current.current.writable,
    error,
    create,
    consumePending,
    updateMessages,
    rename,
    archive,
    associateTrip,
    restoreBackup,
  };
}
