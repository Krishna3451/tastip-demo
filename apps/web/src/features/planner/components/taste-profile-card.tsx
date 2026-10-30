"use client";

import type { TasteProfile } from "@tastip/domain";
import { useState } from "react";
import type { AccountIdentity } from "../use-account";
import { useTasteProfile } from "../use-taste-profile";

export function TasteProfileCard({
  account,
  currentProfile,
  onUse,
}: {
  account: AccountIdentity;
  currentProfile?: TasteProfile;
  onUse?: (profile: TasteProfile) => void;
}) {
  const saved = useTasteProfile(account);
  const [notice, setNotice] = useState("");
  async function save(profile: TasteProfile | null) {
    setNotice("");
    if (await saved.save(profile))
      setNotice(
        profile
          ? "Preferences saved to this account."
          : "Saved preferences forgotten. Existing trips keep their own choices.",
      );
  }
  return (
    <section className="taste-profile-card" aria-label="Saved travel preferences">
      <h3>Your travel preferences</h3>
      <p>
        Save confirmed favorites and travel preferences privately to this account. You choose when
        to use them on another trip.
      </p>
      {saved.busy && <p role="status">Checking saved preferences…</p>}
      {saved.profile ? (
        <>
          <p>
            <strong>{saved.profile.dayStyle}</strong> · {saved.profile.seeds.length} cultural
            favorite{saved.profile.seeds.length === 1 ? "" : "s"}
            {saved.profile.rhythm ? ` · ${saved.profile.rhythm} rhythm` : ""}
          </p>
          <p className="profile-favorites">
            {saved.profile.seeds.map((seed) => seed.name).join(" · ")}
          </p>
          {onUse && (
            <button
              type="button"
              className="button button-secondary"
              disabled={saved.busy}
              onClick={() => onUse(saved.profile!)}
            >
              Use saved preferences
            </button>
          )}
          <button
            type="button"
            className="button button-quiet"
            disabled={saved.busy}
            onClick={() => void save(null)}
          >
            Forget saved preferences
          </button>
        </>
      ) : (
        saved.ready && <p>No preferences saved yet.</p>
      )}
      {currentProfile && (
        <button
          type="button"
          className="button button-secondary"
          disabled={!saved.ready || saved.busy}
          onClick={() => void save(currentProfile)}
        >
          Save preferences from this trip
        </button>
      )}
      {saved.error && <p role="alert">{saved.error}</p>}
      {notice && <p role="status">{notice}</p>}
      {!saved.ready && !saved.busy && (
        <button
          type="button"
          className="button button-secondary"
          onClick={() => void saved.reload()}
        >
          Reload saved preferences
        </button>
      )}
      <small>
        Saving, using or forgetting these preferences leaves existing itineraries unchanged.
      </small>
    </section>
  );
}
