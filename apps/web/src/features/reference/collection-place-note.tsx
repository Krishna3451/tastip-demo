"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_COLLECTION_NOTE_LENGTH } from "../planner/lib/saved-workspace";

/** A draft belongs to one owner/collection/place; the manager keys this component accordingly. */
export function CollectionPlaceNote({
  placeName,
  note,
  ready,
  onSave,
}: {
  placeName: string;
  note: string | undefined;
  ready: boolean;
  onSave: (text: string, expected: string | undefined) => string | null;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [base, setBase] = useState<string | undefined>(undefined);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);
  function finish() {
    setEditing(false);
    setError("");
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  return (
    <section className="mt-collection-place-note" aria-label={`Private note for ${placeName}`}>
      {editing ? (
        <form
          aria-label={`Edit private note for ${placeName}`}
          onSubmit={(event) => {
            event.preventDefault();
            if (!ready) return;
            const error = onSave(draft, base);
            if (error) {
              setError(error);
              return;
            }
            setNotice(draft.trim() ? "Note kept with this collection." : "Note cleared.");
            finish();
          }}
        >
          <label>
            Your private note
            <textarea
              ref={input}
              aria-label={`Note for ${placeName}`}
              maxLength={MAX_COLLECTION_NOTE_LENGTH}
              rows={4}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError("");
              }}
            />
          </label>
          <p className="mt-character-count">
            {draft.length}/{MAX_COLLECTION_NOTE_LENGTH} characters
          </p>
          <p className="mt-muted">
            Kept with this collection, separate from your itinerary and venue details.
            {note && " Clear the text and save to remove this note."}
          </p>
          {error && (
            <p className="mt-error" role="alert">
              {error}
            </p>
          )}
          <div className="mt-collection-note-actions">
            <button type="button" className="mt-pill outlined" onClick={finish}>
              Cancel
            </button>
            <button
              type="submit"
              className="mt-primary"
              disabled={!ready || draft === (base ?? "")}
            >
              Save note
            </button>
          </div>
        </form>
      ) : (
        <>
          {note && (
            <>
              <small>Private note</small>
              <p className="mt-collection-note-text">{note}</p>
            </>
          )}
          <button
            ref={trigger}
            type="button"
            className="mt-pill outlined"
            aria-label={`${note ? "Edit" : "Add"} note for ${placeName}`}
            disabled={!ready}
            onClick={() => {
              setDraft(note ?? "");
              setBase(note);
              setNotice("");
              setError("");
              setEditing(true);
            }}
          >
            {note ? "Edit note" : "Add note"}
          </button>
          {notice && (
            <p className="mt-muted" role="status">
              {notice}
            </p>
          )}
        </>
      )}
    </section>
  );
}
