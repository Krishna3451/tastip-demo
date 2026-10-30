"use client";

import type { Destination, Place, TasteProfile, TasteSeed } from "@tastip/domain";
import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { AccountIdentity } from "../use-account";
import { TasteConnect } from "./taste-connect";
import { TasteProfileCard } from "./taste-profile-card";

export function TasteDialog({
  destinationId,
  destination,
  destinationName,
  configured,
  initialSeeds,
  initialProfile,
  excludedIds,
  replacingDraft,
  onClose,
  onCreate,
  onReview,
  account,
}: {
  destinationId: string;
  destination?: Destination;
  destinationName: string;
  configured: boolean;
  account?: AccountIdentity | null;
  initialSeeds: TasteSeed[];
  initialProfile?: TasteProfile;
  excludedIds: string[];
  replacingDraft: boolean;
  onClose: () => void;
  onCreate: (places: Place[], warnings: string[], profile?: TasteProfile) => void;
  onReview?: (profile: TasteProfile) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [reused, setReused] = useState<TasteProfile | undefined>();
  const [reuseVersion, setReuseVersion] = useState(0);
  const previousFocus = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!previousFocus.current && !dialog.current?.open)
      previousFocus.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = oldOverflow;
      requestAnimationFrame(() => previousFocus.current?.focus());
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="taste-dialog"
      aria-label="Create your taste-led trip"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="studio-top">
        <span className="studio-wordmark">
          tastip<span>✦</span>
        </span>
        <button
          type="button"
          className="icon-button"
          aria-label="Close taste interview"
          onClick={onClose}
        >
          <X size={20} />
        </button>
      </div>
      {account && (
        <TasteProfileCard
          account={account}
          onUse={(profile) => {
            setReused(profile);
            setReuseVersion((value) => value + 1);
          }}
        />
      )}
      <TasteConnect
        key={reuseVersion}
        guided
        destinationId={destinationId}
        destination={destination}
        destinationName={destinationName}
        configured={configured}
        initialSeeds={reused?.seeds ?? initialSeeds}
        initialProfile={reused ?? initialProfile}
        excludedIds={excludedIds}
        replacingDraft={replacingDraft}
        onCreate={onCreate}
        onReview={onReview}
      />
    </dialog>
  );
}
