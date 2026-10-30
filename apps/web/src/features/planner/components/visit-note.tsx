"use client";

import type { TripOperation } from "@tastip/domain";
import { NotebookPen } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function VisitNote({
  tripId,
  version,
  stopId,
  placeId,
  note,
  onCommand,
}: {
  tripId: string;
  version: number;
  stopId: string;
  placeId: string;
  note?: string;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [baseline, setBaseline] = useState({ version, placeId, note: note ?? "" });
  const [error, setError] = useState<string | null>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const textArea = useRef<HTMLTextAreaElement>(null);
  const dirty = draft !== baseline.note;
  const changed = editing && baseline.version !== version;
  const unchanged = baseline.placeId === placeId && baseline.note === (note ?? "");
  useEffect(() => {
    if (!changed) return;
    setError(null);
    if (dirty) return;
    setBaseline({ version, placeId, note: note ?? "" });
    setDraft(note ?? "");
  }, [changed, dirty, version, placeId, note]);

  function loadLatest() {
    setBaseline({ version, placeId, note: note ?? "" });
    setDraft(note ?? "");
    setError(null);
    textArea.current?.focus();
  }
  function finishEditing() {
    setEditing(false);
    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
  }
  return (
    <section className="visit-note" aria-label="Your private visit note">
      <h3>
        <NotebookPen size={16} />A note for this visit
      </h3>
      <p className="visit-note-privacy">
        For your private workspace and downloads. Shared links and your AI companion do not receive
        this note.
      </p>
      {editing ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (changed || draft.trim() === (note ?? "")) return;
            if (
              onCommand([{ type: "set-stop-note", stopId, note: draft }], baseline.version, tripId)
            ) {
              finishEditing();
            } else
              setError(
                "This note could not be saved. Your text is still here; review or reload the latest note before trying again.",
              );
          }}
        >
          <label>
            Your visit note
            <textarea
              ref={textArea}
              maxLength={2000}
              rows={5}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setError(null);
              }}
            />
          </label>
          <small>{draft.length.toLocaleString()} / 2,000</small>
          {changed && dirty && (
            <div className="visit-note-stale" role="status">
              <p>
                Your plan changed. Your note draft is still here.{" "}
                {unchanged
                  ? "Review it with the latest plan before saving."
                  : "This visit’s note or place also changed. Reload the accepted note before editing it."}
              </p>
              {unchanged && (
                <button
                  type="button"
                  className="button button-quiet"
                  onClick={() => {
                    setBaseline({ version, placeId, note: note ?? "" });
                    setError(null);
                    textArea.current?.focus();
                  }}
                >
                  Keep note draft with latest plan
                </button>
              )}
              <button type="button" className="button button-quiet" onClick={loadLatest}>
                Reload latest visit note
              </button>
            </div>
          )}
          <div className="visit-note-actions">
            <button
              type="submit"
              className="button button-secondary"
              disabled={changed || draft.trim() === (note ?? "")}
            >
              Save visit note
            </button>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                finishEditing();
                setError(null);
              }}
            >
              Cancel note edit
            </button>
          </div>
        </form>
      ) : (
        <>
          {note && <p className="visit-note-text">{note}</p>}
          <div className="visit-note-actions">
            <button
              ref={editButton}
              type="button"
              className="button button-secondary"
              onClick={() => {
                setDraft(note ?? "");
                setBaseline({ version, placeId, note: note ?? "" });
                setEditing(true);
                setError(null);
                requestAnimationFrame(() => textArea.current?.focus());
              }}
            >
              {note ? "Edit visit note" : "Add a private note"}
            </button>
            {note && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  if (onCommand([{ type: "set-stop-note", stopId, note: "" }], version, tripId)) {
                    setError(null);
                    requestAnimationFrame(() => editButton.current?.focus({ preventScroll: true }));
                  } else
                    setError(
                      "This note could not be cleared. Reopen the latest visit and try again.",
                    );
                }}
              >
                Clear visit note
              </button>
            )}
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
