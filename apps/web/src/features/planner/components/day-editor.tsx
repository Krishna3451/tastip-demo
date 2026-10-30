"use client";

import type { Trip, TripOperation } from "@tastip/domain";
import { Pencil, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { DayNotesForm } from "./day-notes-form";

export function DayEditor({
  trip,
  dayId,
  onCommand,
}: {
  trip: Trip;
  dayId: string;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const titleId = useId();
  useEffect(() => {
    if (open) dialog.current?.showModal();
    else dialog.current?.close();
  }, [open]);
  function close() {
    setOpen(false);
  }
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="button button-secondary day-editor-trigger"
        aria-label="Edit day title and note"
        onClick={() => setOpen(true)}
      >
        <Pencil size={14} /> Edit day
      </button>
      <dialog
        ref={dialog}
        className="day-editor-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          setOpen(false);
          trigger.current?.focus({ preventScroll: true });
        }}
      >
        <header>
          <div>
            <p className="eyebrow">MAKE THIS DAY YOURS</p>
            <h2 id={titleId}>A title. A little intention.</h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close day editor"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {open && (
          <DayNotesForm
            trip={trip}
            dayId={dayId}
            onCommand={onCommand}
            onSaved={close}
            onCancel={close}
            focusOnMount
          />
        )}
      </dialog>
    </>
  );
}
