"use client";

import { getTripDestination, routeStayDates, type Trip, type TripOperation } from "@tastip/domain";
import { X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { TransferBlocks, TransferEditor } from "./transfer-plans";

export function DayTransfers({
  trip,
  dayId,
  onCommand,
}: {
  trip: Trip;
  dayId: string;
  onCommand: (ops: TripOperation[], version?: number, tripId?: string) => boolean | undefined;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const section = useRef<HTMLDivElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const lastOpenId = useRef<string | null>(null);
  const titleId = useId();
  const route = trip.route;
  const stays = route ? routeStayDates(route) : [];
  const day = trip.days.find((item) => item.id === dayId);
  const untimed =
    route?.transfers.flatMap((transfer, index) => {
      const fromStay = stays[index];
      const toStay = stays[index + 1];
      const from = fromStay && getTripDestination(trip, fromStay.destinationId);
      const to = toStay && getTripDestination(trip, toStay.destinationId);
      return !transfer.timing && toStay?.arrival === day?.date && from && to
        ? [{ transfer, from, to, arrival: toStay.arrival }]
        : [];
    }) ?? [];
  const index = route?.transfers.findIndex((transfer) => transfer.id === openId) ?? -1;
  const selected = index >= 0 ? route?.transfers[index] : undefined;
  const fromStay = selected && route?.stays[index];
  const toStay = selected && route?.stays[index + 1];
  const from = fromStay && getTripDestination(trip, fromStay.destinationId);
  const to = toStay && getTripDestination(trip, toStay.destinationId);
  const opened = Boolean(selected);
  useEffect(() => {
    if (opened) dialog.current?.showModal();
    else dialog.current?.close();
  }, [opened]);
  function close() {
    setOpenId(null);
  }
  function open(id: string) {
    lastOpenId.current = id;
    setOpenId(id);
  }
  if (!route?.transfers.length) return null;
  return (
    <div ref={section} className="day-transfers">
      <TransferBlocks trip={trip} dayId={dayId} onEditTransfer={open} />
      {untimed.map(({ transfer, from, to, arrival }) => (
        <aside
          className="transfer-block day-transfer-untimed"
          aria-label="Travel times to decide"
          key={transfer.id}
        >
          <strong>
            {from.name} → {to.name} ·{" "}
            {transfer.mode === "undecided" ? "Transport to decide" : `${transfer.mode} planned`}
          </strong>
          <p>
            Arrival day: {arrival} · {to.timeZone}. Add times from your own travel plan to reserve
            space in the day.
          </p>
          <small>No service schedule or reservation has been confirmed.</small>
          <button
            type="button"
            className="button button-secondary"
            data-transfer-id={transfer.id}
            aria-label={`Add travel times from ${from.name} to ${to.name}`}
            onClick={() => open(transfer.id)}
          >
            Add travel times
          </button>
        </aside>
      ))}
      <dialog
        ref={dialog}
        className="day-editor-dialog day-transfer-dialog"
        aria-labelledby={titleId}
        onClose={() => {
          const closingId = lastOpenId.current;
          close();
          requestAnimationFrame(() => {
            const trigger = Array.from(
              section.current?.querySelectorAll<HTMLButtonElement>("[data-transfer-id]") ?? [],
            ).find((button) => button.dataset.transferId === closingId);
            if (trigger) trigger.focus({ preventScroll: true });
            else
              section.current
                ?.closest(".day-timeline-inner")
                ?.querySelector<HTMLElement>(".day-timeline-header h3")
                ?.focus({ preventScroll: true });
          });
        }}
      >
        <header>
          <div>
            <p className="eyebrow">ROOM FOR THE JOURNEY</p>
            <h2 id={titleId}>
              Travel from {from?.name ?? "your city"} to {to?.name ?? "your next city"}
            </h2>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close travel time editor"
            onClick={close}
          >
            <X size={18} />
          </button>
        </header>
        {opened && (
          <TransferEditor
            key={selected!.id}
            trip={trip}
            index={index}
            onCommand={onCommand}
            onSaved={close}
            onCancel={close}
            focusOnMount
          />
        )}
      </dialog>
    </div>
  );
}
