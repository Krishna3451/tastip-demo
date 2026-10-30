"use client";

import { ArrowUp, AudioLines, Mic, Plus } from "lucide-react";
import { useState } from "react";
import { Modal } from "./primitives";

export function EntryComposer({
  onSubmit,
  onVoice,
  onAttach,
  placeholder = "Ask Tastip",
}: {
  onSubmit: (text: string) => void;
  onVoice: () => void;
  onAttach?: () => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");
  const [attachments, setAttachments] = useState(false);
  const [info, setInfo] = useState("");
  return (
    <>
      <form
        className="mt-entry-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) {
            onSubmit(draft.trim());
            setDraft("");
          }
        }}
      >
        <label className="sr-only" htmlFor="mt-entry-message">
          Ask Tastip
        </label>
        <textarea
          id="mt-entry-message"
          placeholder={placeholder}
          rows={1}
          value={draft}
          maxLength={4000}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              if (draft.trim()) {
                onSubmit(draft.trim());
                setDraft("");
              }
            }
          }}
        />
        <div>
          <button
            type="button"
            className="mt-icon mt-filled"
            aria-label="Attach"
            aria-expanded={attachments}
            onClick={() => setAttachments(!attachments)}
          >
            <Plus size={21} />
          </button>
          <span />{" "}
          <button type="button" className="mt-icon" aria-label="Dictate" onClick={onVoice}>
            <Mic size={21} />
          </button>
          <button
            className="mt-compose-send"
            type={draft.trim() ? "submit" : "button"}
            aria-label={draft.trim() ? "Send message" : "Start voice"}
            onClick={draft.trim() ? undefined : onVoice}
          >
            {draft.trim() ? <ArrowUp size={22} /> : <AudioLines size={22} />}
          </button>
        </div>
        {attachments && (
          <div className="mt-attach-menu">
            <button
              type="button"
              onClick={() => {
                setAttachments(false);
                if (onAttach) {
                  onAttach();
                  return;
                }
                setInfo(
                  "Trip backups can be imported from Trips → Account trips & backups. Image and document understanding needs an attachment provider before uploads can be sent to chat.",
                );
              }}
            >
              Upload a file
            </button>
            <button
              type="button"
              onClick={() => {
                setAttachments(false);
                if (onAttach) {
                  onAttach();
                  return;
                }
                setDraft(
                  (current) =>
                    `${current}${current ? "\n" : ""}Please help me plan around this link: `,
                );
              }}
            >
              Add a link
            </button>
          </div>
        )}
      </form>
      {info && (
        <Modal title="Attachments" onClose={() => setInfo("")} className="mt-small-dialog">
          <h2>Attachments</h2>
          <p>{info}</p>
        </Modal>
      )}
    </>
  );
}
