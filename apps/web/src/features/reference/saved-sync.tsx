"use client";

import { Cloud, Download, RefreshCw } from "lucide-react";
import { Modal } from "./primitives";
import type { useSavedWorkspace } from "./use-saved-workspace";

export function SavedSync({
  saved,
  onAccount,
}: {
  saved: ReturnType<typeof useSavedWorkspace>;
  onAccount: () => void;
}) {
  const device = saved.dirty ? saved.workspace : saved.device;
  function download() {
    const value = device ?? saved.workspace;
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "tastip-saved-device-copy.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <section className="mt-saved-sync" aria-label="Saved storage">
      <div>
        <Cloud size={18} />
        <p role="status">
          {saved.account
            ? saved.busy
              ? saved.dirty
                ? "Saving to your account…"
                : "Opening account saves…"
              : saved.dirty
                ? "Changes are kept on this device until they sync."
                : saved.ready
                  ? "Saved privately to your Tastip account."
                  : "Your account saves could not open."
            : "Saved privately on this device."}
        </p>
      </div>
      <div className="mt-saved-sync-actions">
        {saved.account ? (
          <>
            <button
              type="button"
              className="mt-pill outlined"
              disabled={saved.busy}
              onClick={() => void saved.reviewAccount()}
            >
              <RefreshCw size={14} />
              Review account saves
            </button>
            {saved.dirty && (
              <button
                type="button"
                className="mt-pill outlined"
                disabled={saved.busy}
                onClick={saved.retry}
              >
                Retry sync
              </button>
            )}
            {device && (
              <button type="button" className="mt-pill" onClick={download}>
                <Download size={14} />
                Download device copy
              </button>
            )}
          </>
        ) : (
          <button type="button" className="mt-pill outlined" onClick={onAccount}>
            Sign in to sync saves
          </button>
        )}
      </div>
      {saved.error && (
        <p className="mt-error" role="alert">
          {saved.error}
        </p>
      )}
      {saved.remote && (
        <Modal
          title="Review account saves"
          onClose={saved.dismissReview}
          className="mt-tools-dialog"
        >
          <h2>Review your saved copies</h2>
          <p>
            Account: {saved.remote.workspace.places.length} places ·{" "}
            {saved.remote.workspace.collections.length} collections.
          </p>
          {device && (
            <p>
              Device copy: {device.places.length} places · {device.collections.length} collections.
            </p>
          )}
          <p className="mt-muted">
            Combining adds device-only places, collection memberships and notes. Account versions of
            existing places, collection names and conflicting notes are kept. Your latest device
            copy is preserved before replacing it.
          </p>
          <div className="mt-dialog-footer">
            <button type="button" className="mt-pill outlined" onClick={saved.useAccountCopy}>
              Use account copy
            </button>
            {device && !saved.blockedDraft && (
              <button type="button" className="mt-primary" onClick={saved.combine}>
                Combine both copies
              </button>
            )}
          </div>
        </Modal>
      )}
    </section>
  );
}
