"use client";

import { useEffect, useState } from "react";
import {
  backupConversations,
  type ConversationBackup,
  parseConversationBackup,
} from "../planner/lib/conversation-backup";
import type { Conversation } from "../planner/lib/conversations";
import { Modal } from "./primitives";

const REVIEW_TITLES = {
  save: "Save this chat backup?",
  restore: "Restore these chats?",
  clear: "Delete the account backup?",
};
const chatCount = (count: number) => `${count} ${count === 1 ? "chat" : "chats"}`;

export function ChatBackup({
  accountId,
  items,
  ready,
  onRestore,
}: {
  accountId: string;
  items: Conversation[];
  ready: boolean;
  onRestore: (items: Conversation[], expectedLocal: string) => boolean;
}) {
  const [backup, setBackup] = useState<ConversationBackup | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [reload, setReload] = useState(0);
  const [review, setReview] = useState<{
    action: "save" | "restore" | "clear";
    local: Conversation[];
    expectedLocal: string;
    backup: ConversationBackup;
  } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: The refresh button intentionally repeats the account read.
  useEffect(() => {
    const controller = new AbortController();
    setBusy(true);
    setError("");
    setBackup(null);
    fetch("/api/conversations", {
      headers: { "X-Tastip-Account": accountId },
      signal: controller.signal,
      cache: "no-store",
    })
      .then(readResponse)
      .then((value) => {
        if (!controller.signal.aborted) setBackup(value);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setError(error instanceof Error ? error.message : "Your chat backup could not be read.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false);
      });
    return () => controller.abort();
  }, [accountId, reload]);

  async function accept() {
    if (!review || busy) return;
    setError("");
    setMessage("");
    if (review.action === "restore") {
      if (onRestore(review.backup.conversations ?? [], review.expectedLocal)) {
        setMessage(
          "Backup restored on this device. Different versions of a chat are kept separately.",
        );
      } else {
        setError("The restore was not saved. Review the chat-storage message before trying again.");
      }
      setReview(null);
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Tastip-Account": accountId },
        body: JSON.stringify({
          action: review.action,
          expectedRevision: review.backup.revision,
          ...(review.action === "save" ? { conversations: backupConversations(review.local) } : {}),
        }),
      });
      setBackup(await readResponse(response));
      setMessage(
        review.action === "clear"
          ? "Account chat backup deleted. Device chats are kept."
          : "Chat backup saved to your account.",
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : "Your chat backup could not be saved.");
    } finally {
      setBusy(false);
      setReview(null);
    }
  }

  return (
    <section className="mt-chat-backup" aria-label="Chat backup">
      <h2>Chat backup</h2>
      <p>
        Save your private chats to your Tastip account, then restore them on another device. Backups
        are manual. Trips and files are saved separately.
      </p>
      <p>
        {chatCount(items.length)} on this device.{" "}
        {backup
          ? backup.conversations === null
            ? "No account backup."
            : `${chatCount(backup.conversations.length)} in your account backup · revision ${backup.revision}.`
          : busy
            ? "Checking your account…"
            : "Account backup unavailable."}
      </p>
      {backup?.updatedAt != null && (
        <p>Last account change: {new Date(backup.updatedAt).toLocaleString()}</p>
      )}
      {error && (
        <p className="mt-inline-error" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      <div className="mt-chat-backup-actions">
        <button
          type="button"
          className="mt-pill"
          disabled={busy}
          onClick={() => {
            setMessage("");
            setReload((value) => value + 1);
          }}
        >
          Refresh backup
        </button>
        {(["save", "restore", "clear"] as const).map((action) => (
          <button
            type="button"
            className={action === "save" ? "mt-primary" : "mt-pill"}
            key={action}
            disabled={
              busy ||
              !ready ||
              !backup ||
              (action !== "save" && backup.conversations === null) ||
              (action === "save" && items.length === 0)
            }
            onClick={() =>
              backup &&
              setReview({
                action,
                local: structuredClone(items),
                expectedLocal: JSON.stringify(items),
                backup,
              })
            }
          >
            {action === "save"
              ? "Save chat backup"
              : action === "restore"
                ? "Restore chats"
                : "Delete account backup"}
          </button>
        ))}
      </div>
      {review && (
        <Modal
          title={REVIEW_TITLES[review.action]}
          onClose={() => {
            if (!busy) setReview(null);
          }}
        >
          <h2>{REVIEW_TITLES[review.action]}</h2>
          <p>
            {review.action === "save"
              ? `Save ${chatCount(review.local.length)} from this device, replacing ${chatCount(review.backup.conversations?.length ?? 0)} in account revision ${review.backup.revision}. Restore first if you want to keep both histories in the next backup.`
              : review.action === "restore"
                ? `Add ${chatCount(review.backup.conversations?.length ?? 0)} from your backup to this device. Existing chats remain; different versions are kept as separate chats. Unsent requests are not resumed and trip changes are not applied.`
                : "Remove the account backup from this server. Chats already saved on your devices remain available."}
          </p>
          <div className="mt-chat-backup-actions">
            <button
              type="button"
              className="mt-pill"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Cancel
            </button>
            <button type="button" className="mt-primary" disabled={busy} onClick={accept}>
              {busy
                ? "Saving…"
                : review.action === "restore"
                  ? "Restore and keep device chats"
                  : review.action === "save"
                    ? "Save reviewed backup"
                    : "Delete reviewed backup"}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
}

async function readResponse(response: Response) {
  const value = await response.json();
  if (!response.ok) throw new Error(value.error?.message ?? "The chat backup request failed.");
  const parsed = parseConversationBackup(value);
  if (!parsed)
    throw new Error("The account backup could not be read. The saved copy has been kept.");
  return parsed;
}
