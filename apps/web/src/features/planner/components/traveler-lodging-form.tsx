"use client";

import {
  type LodgingIdea,
  type TravelerLodging,
  type TripOperation,
  validLodgingIdea,
} from "@tastip/domain";
import { useEffect, useRef, useState } from "react";

function lodgingFields(selected?: LodgingIdea) {
  return {
    name: selected?.source === "traveler" ? selected.name : "",
    address: selected?.source === "traveler" ? (selected.address ?? "") : "",
    website: selected?.source === "traveler" ? (selected.website ?? "") : "",
  };
}

export function TravelerLodgingForm({
  tripId,
  version,
  stayId,
  destinationId,
  selected,
  onCommand,
}: {
  tripId: string;
  version: number;
  stayId: string;
  destinationId: string;
  selected?: LodgingIdea;
  onCommand: (
    operations: TripOperation[],
    version?: number,
    tripId?: string,
  ) => boolean | undefined;
}) {
  const [draft, setDraft] = useState(() => lodgingFields(selected));
  const [baseline, setBaseline] = useState(() => ({
    version,
    signature: JSON.stringify(selected ?? null),
    fields: lodgingFields(selected),
  }));
  const [error, setError] = useState<string | null>(null);
  const details = useRef<HTMLDetailsElement>(null);
  const nameInput = useRef<HTMLInputElement>(null);
  const dirty =
    draft.name !== baseline.fields.name ||
    draft.address !== baseline.fields.address ||
    draft.website !== baseline.fields.website;
  const stale = baseline.version !== version;
  const unchanged = baseline.signature === JSON.stringify(selected ?? null);
  const existing = selected?.source === "traveler" ? selected : undefined;
  useEffect(() => {
    if (dirty || baseline.version === version) return;
    const fields = lodgingFields(selected);
    setDraft(fields);
    setBaseline({ version, signature: JSON.stringify(selected ?? null), fields });
    setError(null);
  }, [version, selected, dirty, baseline.version]);
  function change(fields: Partial<typeof draft>) {
    setDraft((current) => ({ ...current, ...fields }));
    setError(null);
  }
  function reload() {
    const fields = lodgingFields(selected);
    setDraft(fields);
    setBaseline({ version, signature: JSON.stringify(selected ?? null), fields });
    setError(null);
    nameInput.current?.focus();
  }
  return (
    <details ref={details} className="traveler-lodging">
      <summary>
        {existing ? "Edit lodging you added" : "Add lodging you’ve found"}
        <span>Enter it yourself</span>
      </summary>
      <form
        aria-label="Your lodging idea"
        onSubmit={(event) => {
          event.preventDefault();
          if (stale || !dirty) return;
          const candidate: TravelerLodging = {
            id: existing?.id ?? crypto.randomUUID(),
            destinationId,
            name: draft.name.trim(),
            source: "traveler",
            ...(draft.address.trim() ? { address: draft.address.trim() } : {}),
            ...(draft.website.trim() ? { website: draft.website.trim() } : {}),
          };
          if (!validLodgingIdea(candidate)) {
            setError(
              "Enter a lodging name and, if included, a public http or https link without sign-in details.",
            );
            return;
          }
          if (
            onCommand([{ type: "select-lodging", stayId, candidate }], baseline.version, tripId)
          ) {
            const fields = lodgingFields(candidate);
            setDraft(fields);
            setBaseline({
              version: baseline.version + 1,
              signature: JSON.stringify(candidate),
              fields,
            });
            setError(null);
            if (details.current) {
              details.current.open = false;
              details.current.querySelector("summary")?.focus();
            }
          } else
            setError(
              "This lodging idea could not be saved. Your entry is still here; check the planner’s message and try again.",
            );
        }}
      >
        <p>
          Keep a place from your own research. Its name and city appear in shared trip links; the
          address and link you enter stay private. This saves an idea and does not confirm a
          reservation.
        </p>
        <label>
          Lodging name
          <input
            ref={nameInput}
            required
            maxLength={300}
            value={draft.name}
            onChange={(event) => change({ name: event.target.value })}
            placeholder="The place you have in mind"
          />
        </label>
        <label>
          Lodging address <span>Optional · private</span>
          <textarea
            rows={2}
            maxLength={500}
            value={draft.address}
            onChange={(event) => change({ address: event.target.value })}
          />
        </label>
        <label>
          Property or booking link <span>Optional · private</span>
          <input
            type="url"
            maxLength={2000}
            value={draft.website}
            onChange={(event) => change({ website: event.target.value })}
            placeholder="https://"
          />
        </label>
        {selected && (
          <small>This replaces the lodging idea for this city stay. You can undo the change.</small>
        )}
        {stale && dirty && (
          <div className="traveler-lodging-stale" role="status">
            <p>
              Your plan changed. Your lodging draft is still here.{" "}
              {unchanged
                ? "Review it with the latest stay before saving."
                : "The saved lodging idea also changed. Reload it before editing."}
            </p>
            {unchanged && (
              <button
                type="button"
                className="button button-quiet"
                onClick={() => {
                  setBaseline({
                    version,
                    signature: JSON.stringify(selected ?? null),
                    fields: lodgingFields(selected),
                  });
                  setError(null);
                  nameInput.current?.focus();
                }}
              >
                Keep lodging draft with latest plan
              </button>
            )}
            <button type="button" className="button button-quiet" onClick={reload}>
              Reload latest lodging
            </button>
          </div>
        )}
        {error && (
          <p className="inline-error" role="alert">
            {error}
          </p>
        )}
        <div className="traveler-lodging-actions">
          <button type="submit" className="button button-secondary" disabled={stale || !dirty}>
            Save my lodging idea
          </button>
          {dirty && (
            <button type="button" className="button button-quiet" onClick={reload}>
              Reset lodging draft
            </button>
          )}
        </div>
      </form>
    </details>
  );
}
