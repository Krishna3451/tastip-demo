"use client";

import { type Trip, type TripMedia, validMedia } from "@tastip/domain";
import {
  ChevronRight,
  Download,
  ExternalLink,
  FileText,
  Link2,
  Maximize2,
  Minimize2,
  MoreHorizontal,
  Plus,
  Share2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { validateMediaFile } from "../planner/lib/media-files";
import { tripTitle } from "../planner/lib/travel-pack";
import type { Command } from "./itinerary";
import { discardUnattachedBlob, readMediaBlob, saveMediaBlob } from "./media-store";
import { EmptyState, Modal, useSheetDismissal } from "./primitives";

function useAssetUrl(scope: string, item: TripMedia) {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const id = item.id;
  const mimeType = item.kind === "file" ? item.mimeType : "";
  const size = item.kind === "file" ? item.size : 0;
  useEffect(() => {
    setUrl(null);
    setMissing(false);
    if (!mimeType) return;
    let active = true;
    let objectUrl: string | undefined;
    readMediaBlob(scope, id)
      .then((blob) => {
        if (!active) return;
        if (!blob || blob.size !== size || blob.type !== mimeType) {
          setMissing(true);
          return;
        }
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (active) setMissing(true);
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [scope, id, mimeType, size]);
  return { url, missing };
}

export function MediaCard({
  scope,
  item,
  onRemove,
}: {
  scope: string;
  item: TripMedia;
  onRemove?: () => void;
}) {
  const { url, missing } = useAssetUrl(scope, item);
  const [preview, setPreview] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <article className="mt-media-card">
      <div className="mt-media-preview">
        {item.kind === "file" && item.mimeType.startsWith("image/") && url ? (
          <button type="button" aria-label={`View ${item.name}`} onClick={() => setPreview(true)}>
            <img src={url} alt={item.name} />
          </button>
        ) : item.kind === "link" ? (
          <a href={item.url} target="_blank" rel="noreferrer" aria-label={`Open ${item.name}`}>
            <Link2 size={32} />
            <small>{new URL(item.url).hostname}</small>
          </a>
        ) : (
          <span>
            <FileText size={36} />
            <small>PDF</small>
          </span>
        )}
        {onRemove && (
          <div className="mt-media-menu">
            <button
              type="button"
              className="mt-icon"
              aria-label={`Options for ${item.name}`}
              aria-expanded={menu}
              onClick={() => setMenu(!menu)}
            >
              <MoreHorizontal size={20} />
            </button>
            {menu && (
              <div role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    onRemove();
                  }}
                >
                  Remove from trip
                </button>
              </div>
            )}
          </div>
        )}
      </div>
      <strong>{item.name}</strong>
      <small>
        {item.kind === "file" ? `${(item.size / 1024 / 1024).toFixed(1)} MB` : "Web link"} ·{" "}
        {new Date(item.addedAt).toLocaleDateString("en", { day: "numeric", month: "short" })}
      </small>
      {item.kind === "file" && url && (
        <a href={url} download={item.name} className="mt-media-download">
          <Download size={14} />
          Download
        </a>
      )}
      {item.kind === "link" && (
        <a href={item.url} target="_blank" rel="noreferrer" className="mt-media-download">
          <ExternalLink size={14} />
          Open link
        </a>
      )}
      {missing && <p className="mt-media-missing">This file is not available on this device.</p>}
      {preview && url && (
        <Modal title={item.name} className="mt-media-lightbox" onClose={() => setPreview(false)}>
          <img src={url} alt={item.name} />
          <a href={url} download={item.name} className="mt-pill outlined">
            <Download size={16} />
            Download
          </a>
        </Modal>
      )}
    </article>
  );
}

export function MediaLibrary({
  scope,
  trip,
  onCommand,
  purpose = "media",
  onAdded,
}: {
  scope: string;
  trip: Trip;
  onCommand: Command;
  purpose?: "media" | "receipt";
  onAdded?: () => void;
}) {
  const [addMenu, setAddMenu] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const items =
    purpose === "receipt"
      ? (trip.media ?? []).filter((item) => item.purpose === "receipt")
      : (trip.media ?? []);
  async function upload(file: File) {
    if (busy) return;
    setBusy(true);
    setError("");
    const id = crypto.randomUUID();
    let saved = false;
    try {
      const mimeType = await validateMediaFile(file);
      if (!mounted.current) return;
      await saveMediaBlob(scope, id, new Blob([file], { type: mimeType }));
      saved = true;
      if (!mounted.current) {
        await discardUnattachedBlob(scope, id);
        return;
      }
      const media: TripMedia = {
        id,
        name:
          Array.from(file.name)
            .map((character) => (character.charCodeAt(0) < 32 ? " " : character))
            .join("")
            .trim()
            .slice(0, 240) || "Untitled file",
        kind: "file",
        mimeType,
        size: file.size,
        purpose,
        addedAt: new Date().toISOString(),
      };
      if (!onCommand([{ type: "add-media", media }], trip.version, trip.id)) {
        await discardUnattachedBlob(scope, id);
        throw new Error("The trip changed while this file was saving. Try adding it again.");
      }
      onAdded?.();
    } catch (cause) {
      if (saved) await discardUnattachedBlob(scope, id).catch(() => {});
      if (mounted.current)
        setError(cause instanceof Error ? cause.message : "This file could not be saved.");
    } finally {
      if (mounted.current) {
        setBusy(false);
        if (input.current) input.current.value = "";
      }
    }
  }
  function addLink(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    let url: URL;
    try {
      url = new URL(link.includes("://") ? link.trim() : `https://${link.trim()}`);
    } catch {
      setError("Enter a valid website or video link.");
      return;
    }
    const media: TripMedia = {
      id: crypto.randomUUID(),
      name: url.hostname,
      kind: "link",
      url: url.toString(),
      purpose,
      addedAt: new Date().toISOString(),
    };
    if (!validMedia(media)) {
      setError("Use an http or https link without embedded sign-in details.");
      return;
    }
    if (onCommand([{ type: "add-media", media }], trip.version, trip.id)) {
      setLinkOpen(false);
      setLink("");
      onAdded?.();
    }
  }
  return (
    <>
      <input
        ref={input}
        className="sr-only"
        type="file"
        aria-label={purpose === "receipt" ? "Upload receipt file" : "Upload media file"}
        accept="image/jpeg,image/png,image/webp,application/pdf"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <div className="mt-media-add-wrap">
        <button
          type="button"
          className="mt-pill outlined"
          aria-label={purpose === "receipt" ? "Upload receipt" : "Add media"}
          aria-expanded={addMenu}
          disabled={busy || (trip.media?.length ?? 0) >= 50}
          onClick={() => (purpose === "receipt" ? input.current?.click() : setAddMenu(!addMenu))}
        >
          <Plus size={18} />
          {busy ? "Saving file…" : purpose === "receipt" ? "Upload receipt" : "Add media"}
        </button>
        {addMenu && (
          <div role="menu" aria-label="Add media">
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setAddMenu(false);
                input.current?.click();
              }}
            >
              <Upload size={20} />
              <span>
                <strong>Add a file</strong>
                <small>Upload a photo, screenshot, or PDF.</small>
              </span>
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setAddMenu(false);
                setLinkOpen(true);
              }}
            >
              <Link2 size={20} />
              <span>
                <strong>Add a link</strong>
                <small>Add a link to videos, social posts and articles.</small>
              </span>
            </button>
          </div>
        )}
      </div>
      {error && !linkOpen && (
        <p role="alert" className="mt-error">
          {error}
        </p>
      )}
      {items.length ? (
        <div className="mt-media-grid">
          {items.map((item) => (
            <MediaCard
              key={item.id}
              scope={scope}
              item={item}
              onRemove={() =>
                onCommand([{ type: "remove-media", mediaId: item.id }], trip.version, trip.id)
              }
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={44} />}
          title={
            purpose === "receipt" ? "All your receipts, in one place" : "See it. Love it. Save it."
          }
          description={
            purpose === "receipt"
              ? "Keep a photo or PDF of your receipt with this trip. Receipt details are not extracted automatically."
              : "Stash all your inspo — posts, videos, photos and files — in one place for easy planning later."
          }
        />
      )}
      <p className="mt-media-storage-note">
        Files are private and saved on this device. Trip backups keep file details and links;
        download files separately. Photos and PDFs up to 10 MB each.
      </p>
      {linkOpen && (
        <Modal
          title="Add a link"
          className="mt-media-link-dialog"
          onClose={() => {
            setLinkOpen(false);
            setError("");
          }}
        >
          <h2>Add a link</h2>
          <form onSubmit={addLink}>
            <input
              autoComplete="off"
              aria-label="Paste a link to website or video…"
              placeholder="Paste a link to website or video…"
              value={link}
              maxLength={2048}
              onChange={(event) => setLink(event.target.value)}
            />
            <button className="mt-primary" type="submit" disabled={!link.trim()}>
              Add
            </button>
          </form>
          {error && (
            <p role="alert" className="mt-error">
              {error}
            </p>
          )}
        </Modal>
      )}
    </>
  );
}

export function MediaPanel({
  scope,
  trip,
  onCommand,
  onClose,
  onShare,
}: {
  scope: string;
  trip: Trip;
  onCommand: Command;
  onClose: () => void;
  onShare: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sheet = useSheetDismissal(onClose);
  return (
    <section
      ref={sheet}
      className={`mt-media-sheet ${expanded ? "expanded" : ""}`}
      aria-label="Trip media"
    >
      <header>
        <button type="button" className="mt-icon" aria-label="Close media" onClick={onClose}>
          <X size={20} />
        </button>
        <button
          type="button"
          className="mt-icon"
          aria-label={expanded ? "Collapse media" : "Expand media"}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
        </button>
        <button type="button" className="mt-icon" aria-label="Share trip" onClick={onShare}>
          <Share2 size={18} />
        </button>
      </header>
      <h1>Media</h1>
      <MediaLibrary key={`${scope}:${trip.id}`} scope={scope} trip={trip} onCommand={onCommand} />
    </section>
  );
}

export function ReceiptsWorkspace({
  scope,
  trips,
  activeTrip,
  onSelect,
  onCommand,
  onCreate,
  onOpen,
}: {
  scope: string;
  trips: Trip[];
  activeTrip: Trip | null;
  onSelect: (trip: Trip) => boolean;
  onCommand: Command;
  onCreate: () => void;
  onOpen: (trip: Trip) => void;
}) {
  const [upload, setUpload] = useState(false);
  const receipts = trips.flatMap((trip) =>
    (trip.media ?? []).filter((item) => item.purpose === "receipt").map((item) => ({ trip, item })),
  );
  return (
    <div className="mt-page-content">
      <div className="mt-page-heading">
        <h1>Your receipts</h1>
        <button type="button" className="mt-primary" onClick={() => setUpload(true)}>
          <Upload size={18} />
          Upload
        </button>
      </div>
      <nav className="mt-tabs" aria-label="Trips views">
        <Link href="/trips">Trips</Link>
        <Link href="/calendar">Calendar</Link>
        <Link className="selected" href="/receipts">
          Receipts
        </Link>
      </nav>
      {receipts.length ? (
        <div className="mt-receipts-grid">
          {receipts.map(({ trip, item }) => (
            <div key={`${trip.id}:${item.id}`}>
              <MediaCard scope={scope} item={item} />
              <button className="mt-receipt-trip" type="button" onClick={() => onOpen(trip)}>
                {tripTitle(trip)}
                <ChevronRight size={15} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<FileText size={42} />}
          title="All your receipts, in one place"
          description="Upload a photo or PDF and keep it with your trip."
        />
      )}
      {upload && (
        <Modal
          title="Upload a receipt"
          className="mt-receipt-upload-dialog"
          onClose={() => setUpload(false)}
        >
          <h2>Upload a receipt</h2>
          {trips.length ? (
            <>
              <label>
                Trip
                <select
                  value={activeTrip?.id ?? ""}
                  onChange={(event) => {
                    const trip = trips.find((item) => item.id === event.target.value);
                    if (trip) onSelect(trip);
                  }}
                >
                  <option disabled value="">
                    Choose a trip
                  </option>
                  {trips.map((trip) => (
                    <option value={trip.id} key={trip.id}>
                      {tripTitle(trip)}
                    </option>
                  ))}
                </select>
              </label>
              {activeTrip && (
                <MediaLibrary
                  key={`${scope}:${activeTrip.id}`}
                  scope={scope}
                  trip={activeTrip}
                  onCommand={onCommand}
                  purpose="receipt"
                  onAdded={() => setUpload(false)}
                />
              )}
            </>
          ) : (
            <EmptyState
              icon={<FileText size={32} />}
              title="Choose a trip for this receipt"
              description="Create a trip first to keep your receipt with the right plans."
              action={
                <button
                  className="mt-primary"
                  type="button"
                  onClick={() => {
                    setUpload(false);
                    onCreate();
                  }}
                >
                  Create a trip
                </button>
              }
            />
          )}
        </Modal>
      )}
    </div>
  );
}
