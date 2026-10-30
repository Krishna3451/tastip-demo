"use client";

import type { Place } from "@tastip/domain";
import {
  ArrowLeft,
  BookOpen,
  ChevronRight,
  Ellipsis,
  Folder,
  Heart,
  Plus,
  Search,
  Sparkles,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { z } from "zod";
import {
  type SavedCollection,
  savedCollectionNote,
  savedCollectionSchema,
} from "../planner/lib/saved-workspace";
import { CollectionPlaceNote } from "./collection-place-note";
import { PlaceCard } from "./home";
import { EmptyState, Modal } from "./primitives";

const guideSchema = z.object({
  id: z.string().uuid(),
  title: z.string().trim().min(1).max(160),
  description: z.string().max(5000),
  placeIds: z.array(z.string().max(200)).max(150),
});
const agentSchema = z.object({
  id: z.string().uuid(),
  prompt: z.string().trim().min(1).max(2000),
  frequency: z.enum(["Daily", "Weekly", "Monthly"]),
  day: z.string().max(30),
  notify: z.enum(["Every run", "Only real finds", "Urgent"]),
});
type Guide = z.infer<typeof guideSchema>;
type Agent = z.infer<typeof agentSchema>;

function useLocalRecords<T>(key: string, schema: z.ZodType<T>) {
  const blocked = useRef(false);
  const [items, setItems] = useState<T[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setReady(false);
    setItems([]);
    blocked.current = false;
    try {
      const value = z
        .array(schema)
        .max(50)
        .safeParse(JSON.parse(localStorage.getItem(key) ?? "[]"));
      if (!value.success) throw new Error();
      setItems(value.data);
    } catch {
      blocked.current = true;
      setError(
        "These saved records could not be read. Your current records have not been replaced.",
      );
    }
    setReady(true);
  }, [key, schema]);
  function save(next: T[]) {
    if (!ready || blocked.current) return false;
    const checked = z.array(schema).max(50).safeParse(next);
    if (!checked.success) {
      setError("Check the details before saving. Up to 50 records can be kept on this device.");
      return false;
    }
    try {
      localStorage.setItem(key, JSON.stringify(checked.data));
      setItems(checked.data);
      setError("");
      return true;
    } catch {
      setError("This browser could not save your changes.");
      return false;
    }
  }
  return { items, save, error, ready };
}

type PlaceActions = {
  places: Place[];
  savedIds: string[];
  onSave: (place: Place) => void;
  onPlace: (place: Place) => void;
  onAdd: (place: Place) => void;
};
export function CollectionManager({
  collections,
  onCollectionsChange,
  ready,
  error,
  account,
  syncControls,
  onDiscover,
  places,
  savedIds,
  onSave,
  onPlace,
  onAdd,
}: {
  collections: SavedCollection[];
  onCollectionsChange: (items: SavedCollection[]) => boolean;
  ready: boolean;
  error: string;
  account: boolean;
  syncControls?: ReactNode;
  onDiscover: (collectionId?: string) => void;
} & PlaceActions) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selected = searchParams.get("collection");
  const tab =
    searchParams.get("view") === "places"
      ? "Places"
      : searchParams.get("view") === "guides"
        ? "Guides"
        : "Collections";
  const records = { items: collections, save: onCollectionsChange, ready, error };
  const currentRecords = useRef(records);
  currentRecords.current = records;
  const importGeneration = useRef(0);
  const mounted = useRef(true);
  const [importing, setImporting] = useState(false);
  const pendingImport = useRef<File | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      importGeneration.current++;
    };
  }, []);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [info, setInfo] = useState("");
  const [adding, setAdding] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [membershipBase, setMembershipBase] = useState<string[]>([]);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SavedCollection | null>(null);
  const [rename, setRename] = useState("");
  const [removed, setRemoved] = useState<SavedCollection[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const collection = records.items.find((item) => item.id === selected);
  const missing = Boolean(selected && !collection && ready);
  const visible = places.filter(
    (place) =>
      place.name.toLowerCase().includes(query.toLowerCase()) &&
      (!collection || collection.placeIds.includes(place.id)),
  );
  function navigate(collectionId?: string, view?: string) {
    const query = new URLSearchParams();
    if (collectionId) query.set("collection", collectionId);
    else if (view && view !== "Collections") query.set("view", view.toLowerCase());
    setMenu(null);
    setAdding(false);
    setRenaming(null);
    setQuery("");
    router.push(query.size ? `/saved?${query}` : "/saved", { scroll: false });
  }
  function addPlaces() {
    if (!ready || !collection) return;
    setChosen([...collection.placeIds]);
    setMembershipBase([...collection.placeIds]);
    setAdding(true);
  }
  function beginRename(item: SavedCollection) {
    setMenu(null);
    setRename(item.name);
    setRenaming({ ...item, placeIds: [...item.placeIds] });
  }
  function removeCollection(item: SavedCollection) {
    if (!ready) return;
    const current = records.items.find((candidate) => candidate.id === item.id);
    if (!current) return;
    if (records.save(records.items.filter((candidate) => candidate.id !== item.id))) {
      setRemoved((previous) => [
        ...previous.filter((candidate) => candidate.id !== item.id),
        current,
      ]);
      setMenu(null);
      if (selected === item.id) navigate();
    }
  }
  function restoreCollection(item: SavedCollection) {
    if (!ready) return;
    if (records.items.some((candidate) => candidate.id === item.id)) {
      setInfo("This collection already exists. Its current version has been kept.");
      return;
    }
    if (records.save([...records.items, item]))
      setRemoved((previous) => previous.filter((candidate) => candidate.id !== item.id));
  }
  function collectionOptions(item: SavedCollection) {
    return (
      <fieldset
        className="mt-collection-options"
        aria-label={`Options for ${item.name} collection`}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setMenu(null);
        }}
      >
        <button
          type="button"
          className="mt-icon"
          aria-label={`Options for ${item.name}`}
          aria-haspopup="menu"
          aria-expanded={menu === item.id}
          disabled={!ready}
          onClick={() => setMenu(menu === item.id ? null : item.id)}
        >
          <Ellipsis size={19} />
        </button>
        {menu === item.id && (
          <div
            className="mt-collection-menu"
            role="menu"
            aria-label={`Collection actions for ${item.name}`}
          >
            <button type="button" role="menuitem" onClick={() => beginRename(item)}>
              Rename
            </button>
            <button type="button" role="menuitem" onClick={() => removeCollection(item)}>
              Remove collection
            </button>
          </div>
        )}
      </fieldset>
    );
  }
  async function importCollection(upload: File | undefined) {
    if (!upload || !currentRecords.current.ready) return;
    const run = ++importGeneration.current;
    const baseline = JSON.stringify(currentRecords.current.items);
    pendingImport.current = upload;
    setImporting(true);
    try {
      if (upload.size > 1024 * 1024)
        throw new Error("Choose a collection backup smaller than 1 MB.");
      const parsed = savedCollectionSchema.safeParse(JSON.parse(await upload.text()));
      if (!mounted.current || run !== importGeneration.current) return;
      if (!parsed.success || new Set(parsed.data.placeIds).size !== parsed.data.placeIds.length)
        throw new Error("Choose a valid Tastip collection JSON backup.");
      const latest = currentRecords.current;
      if (!latest.ready || JSON.stringify(latest.items) !== baseline)
        throw new Error(
          "Your saves changed or started syncing while this file was opening. Nothing was imported. Your file is kept; retry import when Saved is ready.",
        );
      const next = { ...parsed.data, id: crypto.randomUUID() };
      if (latest.save([...latest.items, next])) {
        pendingImport.current = null;
        if (file.current) file.current.value = "";
        navigate();
        setInfo("Collection imported. Places appear when their sourced records are also in Saved.");
      } else
        setInfo("This import could not be kept. Your file is retained; retry when Saved is ready.");
    } catch (cause) {
      if (mounted.current && run === importGeneration.current)
        setInfo(cause instanceof Error ? cause.message : "The collection could not be imported.");
    } finally {
      if (mounted.current && run === importGeneration.current) setImporting(false);
    }
  }
  return (
    <div className="mt-page-content">
      <div className="mt-page-heading">
        <div>
          {(collection || missing) && (
            <button className="mt-pill outlined" type="button" onClick={() => navigate()}>
              <ArrowLeft size={16} />
              Collections
            </button>
          )}
          <h1>{collection?.name ?? (missing ? "Collection unavailable" : "Your collections")}</h1>
          {collection && (
            <p className="mt-muted">
              Private · {visible.length} saved {visible.length === 1 ? "place" : "places"}
            </p>
          )}
        </div>
        <div className="mt-heading-actions">
          {collection && collectionOptions(collection)}
          <button
            type="button"
            className="mt-icon"
            aria-label="Upload files"
            onClick={() =>
              setInfo(
                "File extraction is not connected yet. You can import a Tastip collection JSON backup or add places from discovery.",
              )
            }
          >
            <Upload size={20} />
          </button>
          <button
            type="button"
            className="mt-pill outlined"
            disabled={!ready || importing}
            onClick={() => file.current?.click()}
          >
            {importing ? "Opening file…" : "Import"}
          </button>
          {pendingImport.current && !importing && (
            <button
              type="button"
              className="mt-pill outlined"
              disabled={!ready}
              onClick={() => void importCollection(pendingImport.current ?? undefined)}
            >
              Retry import
            </button>
          )}
          {!missing && (
            <button
              type="button"
              className="mt-primary"
              disabled={!ready}
              onClick={() => {
                if (collection) addPlaces();
                else {
                  setName("");
                  setCreating(true);
                }
              }}
            >
              {collection ? "Add places" : "Create"}
            </button>
          )}
        </div>
      </div>
      {syncControls}
      {removed.map((item) => (
        <div key={item.id} className="mt-collection-removed" role="status">
          <p>“{item.name}” was removed from collections. Your saved places are kept.</p>
          <button
            type="button"
            className="mt-pill outlined"
            disabled={!ready}
            onClick={() => restoreCollection(item)}
          >
            Restore collection
          </button>
        </div>
      ))}
      <input
        type="file"
        accept="application/json,.json"
        ref={file}
        hidden
        onChange={(event) => void importCollection(event.target.files?.[0])}
      />
      {!collection && !missing && (
        <nav className="mt-tabs" aria-label="Saved views">
          {[
            ["Collections", records.items.length],
            ["Places", places.length],
            ["Guides", 0],
          ].map(([label, count]) => (
            <button
              type="button"
              key={label}
              className={tab === label ? "selected" : ""}
              aria-pressed={tab === label}
              onClick={() => navigate(undefined, String(label))}
            >
              {label}
              <span className="mt-count">{count}</span>
            </button>
          ))}
        </nav>
      )}
      {!missing && (
        <div className="mt-search mt-saved-search">
          <Search size={18} />
          <input
            aria-label="Search my saves"
            placeholder="Search my saves"
            value={query}
            maxLength={200}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
      )}
      {records.error && (
        <p className="mt-error" role="alert">
          {records.error}
        </p>
      )}
      {missing ? (
        <EmptyState
          icon={<Folder size={36} />}
          title="This collection is not in your workspace"
          description="Refresh account saves or return to your collections."
          action={
            <button type="button" className="mt-primary" onClick={() => navigate()}>
              Your collections
            </button>
          }
        />
      ) : !collection && tab === "Collections" ? (
        records.items.length ? (
          <div className="mt-collection-grid">
            {records.items
              .filter((item) => item.name.toLowerCase().includes(query.toLowerCase()))
              .map((item) => {
                const images = item.placeIds
                  .flatMap((id) => {
                    const place = places.find((candidate) => candidate.id === id);
                    return place?.facts?.imageUrl
                      ? [{ id, name: place.name, src: place.facts.imageUrl }]
                      : [];
                  })
                  .slice(0, 4);
                return (
                  <article key={item.id} className="mt-collection-entry">
                    <button
                      className="mt-collection-card"
                      type="button"
                      onClick={() => navigate(item.id)}
                    >
                      <span className={images.length ? "mt-collection-cover" : undefined}>
                        {images.length ? (
                          images.map((image) => (
                            <img
                              key={image.id}
                              src={image.src}
                              alt={image.name}
                              loading="lazy"
                              referrerPolicy="no-referrer"
                            />
                          ))
                        ) : (
                          <Folder size={40} strokeWidth={1} />
                        )}
                      </span>
                      <strong>{item.name}</strong>
                      <small>
                        {
                          item.placeIds.filter((id) => places.some((place) => place.id === id))
                            .length
                        }{" "}
                        places · Private
                      </small>
                    </button>
                    {collectionOptions(item)}
                  </article>
                );
              })}
          </div>
        ) : (
          <EmptyState
            icon={<Folder size={36} />}
            title="Keep your ideas together"
            description="Create a private collection for your next trip or a place you’d like to explore."
            action={
              <button
                type="button"
                className="mt-primary"
                disabled={!ready}
                onClick={() => {
                  setName("");
                  setCreating(true);
                }}
              >
                Create a collection
              </button>
            }
          />
        )
      ) : tab === "Guides" && !collection ? (
        <EmptyState
          icon={<BookOpen size={36} />}
          title="Your saved guides"
          description="Guides you save will appear here."
          action={
            <Link className="mt-primary" href="/inspiration">
              Find inspiration
            </Link>
          }
        />
      ) : visible.length ? (
        <div className="mt-place-grid">
          {visible.map((place) => (
            <div
              className="mt-collection-place-entry"
              key={`${collection?.id ?? "all"}:${place.id}`}
            >
              <PlaceCard
                place={place}
                saved={savedIds.includes(place.id)}
                onSave={() => onSave(place)}
                onOpen={() => onPlace(place)}
                onAdd={() => onAdd(place)}
              />
              {collection && (
                <CollectionPlaceNote
                  placeName={place.name}
                  note={savedCollectionNote(collection, place.id)}
                  ready={ready}
                  onSave={(text, expected) => {
                    const latest = records.items.find((item) => item.id === collection.id);
                    if (!ready || !latest || !latest.placeIds.includes(place.id))
                      return "This place is no longer available in this collection. Your draft has been kept.";
                    if (savedCollectionNote(latest, place.id) !== expected)
                      return "This note changed. Your draft has been kept; cancel and reopen it to review the latest note.";
                    const checked = savedCollectionSchema.safeParse({
                      ...latest,
                      placeNotes: { ...latest.placeNotes, [place.id]: text.trim() ? text : "" },
                    });
                    if (!checked.success)
                      return "Keep notes within 2,000 characters and 150 places per collection. Your draft has been kept.";
                    return records.save(
                      records.items.map((item) => (item.id === latest.id ? checked.data : item)),
                    )
                      ? null
                      : "This note could not be kept. Your draft is still here; review account saves or try again.";
                  }}
                />
              )}
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Heart size={36} />}
          title={
            query
              ? "No matching saves"
              : collection
                ? "A little space for your next idea"
                : "Save somewhere you’d love to go"
          }
          description={
            query
              ? "Try another name or clear your search."
              : collection
                ? "Add places you’ve saved, or find your kind of places in discovery."
                : "Discover places around your favorites, then save the ones you want to keep."
          }
          action={
            <button
              type="button"
              className="mt-primary"
              disabled={!ready}
              onClick={() => onDiscover(collection?.id)}
            >
              Find more places
            </button>
          }
        />
      )}
      {creating && (
        <Modal
          title="Create a collection"
          onClose={() => setCreating(false)}
          className="mt-picker-dialog mt-collection-dialog"
        >
          <h2>Create a collection</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                ready &&
                records.save([
                  ...records.items,
                  { id: crypto.randomUUID(), name: name.trim(), placeIds: [] },
                ])
              )
                setCreating(false);
            }}
          >
            <label>
              Name
              <input
                placeholder="Holiday ideas"
                value={name}
                maxLength={50}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <p className="mt-character-count">{name.length}/50 characters</p>
            <div className="mt-collection-privacy">
              <h3>Private collection</h3>
              <p>
                {account
                  ? "Only you can view this collection in your Tastip account."
                  : "This collection stays on this device, in your workspace."}
              </p>
            </div>
            <button className="mt-primary" type="submit" disabled={!ready || !name.trim()}>
              Create
            </button>
          </form>
        </Modal>
      )}
      {renaming && (
        <Modal
          title="Rename collection"
          onClose={() => setRenaming(null)}
          className="mt-picker-dialog mt-collection-dialog"
        >
          <h2>Rename collection</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const current = records.items.find((item) => item.id === renaming.id);
              if (!ready || !current) return;
              if (current.name !== renaming.name) {
                setInfo(
                  "This collection changed. Your rename has not been applied; reopen it against the latest collection.",
                );
                return;
              }
              if (
                records.save(
                  records.items.map((item) =>
                    item.id === renaming.id ? { ...item, name: rename.trim() } : item,
                  ),
                )
              )
                setRenaming(null);
            }}
          >
            <label>
              Collection name
              <input
                value={rename}
                maxLength={50}
                onChange={(event) => setRename(event.target.value)}
              />
            </label>
            <p className="mt-character-count">{rename.length}/50 characters</p>
            <button className="mt-primary" type="submit" disabled={!ready || !rename.trim()}>
              Update
            </button>
          </form>
        </Modal>
      )}
      {adding && collection && (
        <Modal title="Add places" onClose={() => setAdding(false)} className="mt-small-dialog">
          <h2>Add places</h2>
          <p className="mt-muted">Choose from your saved places.</p>
          <div className="mt-checkbox-list">
            {places.map((place) => (
              <label key={place.id}>
                <input
                  type="checkbox"
                  disabled={!ready}
                  checked={chosen.includes(place.id)}
                  onChange={() =>
                    setChosen((current) =>
                      current.includes(place.id)
                        ? current.filter((id) => id !== place.id)
                        : [...current, place.id],
                    )
                  }
                />
                {place.name}
              </label>
            ))}
          </div>
          <div className="mt-dialog-footer">
            <button
              type="button"
              className="mt-pill outlined"
              disabled={!ready}
              onClick={() => {
                setAdding(false);
                onDiscover(collection.id);
              }}
            >
              Find more places
            </button>
            <button
              type="button"
              className="mt-primary"
              disabled={!ready}
              onClick={() => {
                if (JSON.stringify(collection.placeIds) !== JSON.stringify(membershipBase)) {
                  setInfo(
                    "This collection’s places changed. Reopen Add places before updating it; your choices have not overwritten the newer collection.",
                  );
                  return;
                }
                if (
                  records.save(
                    records.items.map((item) =>
                      item.id === collection.id ? { ...item, placeIds: chosen } : item,
                    ),
                  )
                )
                  setAdding(false);
              }}
            >
              Update
            </button>
          </div>
        </Modal>
      )}
      {info && (
        <Modal title="Collections" onClose={() => setInfo("")} className="mt-small-dialog">
          <h2>Collections</h2>
          <p>{info}</p>
        </Modal>
      )}
    </div>
  );
}

export function AgentManager({
  storageKey,
  manage,
  onChat,
}: {
  storageKey: string;
  manage: boolean;
  onChat: (message: string) => void;
}) {
  const records = useLocalRecords<Agent>(storageKey, agentSchema);
  const [creating, setCreating] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [frequency, setFrequency] = useState<Agent["frequency"]>("Weekly");
  const [day, setDay] = useState("Any day");
  const [notify, setNotify] = useState<Agent["notify"]>("Only real finds");
  const [info, setInfo] = useState("");
  return (
    <div className="mt-agent-page">
      <div className="mt-agent-top">
        <Link href="/home" className="mt-icon" aria-label="Home">
          <ArrowLeft size={17} />
        </Link>
        <button type="button" className="mt-primary" onClick={() => setCreating(true)}>
          <Plus size={16} />
          Create
        </button>
      </div>
      <div className="mt-agent-content">
        <h1>Your agents</h1>
        <p>Watching what matters to you, on a schedule you set.</p>
        <nav className="mt-tabs" aria-label="Agents views">
          <Link href="/agents" className={!manage ? "selected" : ""}>
            Results
          </Link>
          <Link href="/agents/manage" className={manage ? "selected" : ""}>
            Manage
          </Link>
        </nav>
        {records.error && (
          <p className="mt-error" role="alert">
            {records.error}
          </p>
        )}
        {manage ? (
          records.items.map((agent) => (
            <article className="mt-agent-record" key={agent.id}>
              <header>
                <span className="mt-pill">{agent.frequency} · Draft</span>
                <button
                  className="mt-icon"
                  type="button"
                  aria-label="Agent actions"
                  onClick={() =>
                    setInfo(
                      "This agent is saved as a draft on this device. Scheduling requires a connected server worker; it has not been enabled.",
                    )
                  }
                >
                  <Ellipsis size={19} />
                </button>
              </header>
              <h2>{agent.prompt}</h2>
              <p>
                {agent.day} · {agent.notify}
              </p>
              <footer>
                <button
                  className="mt-pill outlined"
                  type="button"
                  onClick={() => setInfo("No scheduled runs have occurred for this draft.")}
                >
                  History
                </button>
                <button className="mt-pill" type="button" onClick={() => onChat(agent.prompt)}>
                  Run now <ChevronRight size={16} />
                </button>
              </footer>
            </article>
          ))
        ) : (
          <EmptyState
            icon={<Sparkles size={36} />}
            title="Nothing to catch up on yet"
            description="Your agents’ results will appear here. Background runs need a connected scheduler."
          />
        )}
      </div>
      {creating && (
        <Modal
          title="Create a custom agent"
          onClose={() => setCreating(false)}
          className="mt-agent-dialog"
        >
          <h2>Create a custom agent</h2>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (
                records.save([
                  ...records.items,
                  { id: crypto.randomUUID(), prompt, frequency, day, notify },
                ])
              ) {
                setCreating(false);
                setInfo(
                  "Agent saved as a draft. Scheduling has not been enabled because no server worker is connected.",
                );
              }
            }}
          >
            <label>
              What I’ll look for
              <textarea
                placeholder="e.g. Watch for new ramen spots opening around East Austin and tell me about the good ones every week"
                value={prompt}
                maxLength={2000}
                onChange={(event) => setPrompt(event.target.value)}
              />
            </label>
            <h3>Schedule</h3>
            <div className="mt-time-fields">
              <label>
                Frequency
                <select
                  value={frequency}
                  onChange={(event) => setFrequency(event.target.value as Agent["frequency"])}
                >
                  {["Daily", "Weekly", "Monthly"].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <label>
                Day
                <select value={day} onChange={(event) => setDay(event.target.value)}>
                  {[
                    "Any day",
                    "Monday",
                    "Tuesday",
                    "Wednesday",
                    "Thursday",
                    "Friday",
                    "Saturday",
                    "Sunday",
                  ].map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
            </div>
            <h3>Notify me</h3>
            <div className="mt-setup-chips">
              {(["Every run", "Only real finds", "Urgent"] as const).map((value) => (
                <button
                  type="button"
                  key={value}
                  aria-pressed={notify === value}
                  onClick={() => setNotify(value)}
                >
                  {value}
                </button>
              ))}
            </div>
            <p className="mt-muted">Stays quiet unless it finds something worth your attention.</p>
            <div className="mt-dialog-footer">
              <button className="mt-pill outlined" type="button" onClick={() => setCreating(false)}>
                Cancel
              </button>
              <button type="submit" className="mt-primary" disabled={!prompt.trim()}>
                Create
              </button>
            </div>
          </form>
        </Modal>
      )}
      {info && (
        <Modal title="Agent status" className="mt-small-dialog" onClose={() => setInfo("")}>
          <h2>Agent status</h2>
          <p>{info}</p>
        </Modal>
      )}
    </div>
  );
}

export function CreatorHub({
  username,
  storageKey,
  places,
}: {
  username: string;
  storageKey: string;
  places: Place[];
}) {
  const records = useLocalRecords<Guide>(storageKey, guideSchema);
  const [tab, setTab] = useState("Guides");
  const [editing, setEditing] = useState<Guide | null>(null);
  const [info, setInfo] = useState("");
  return (
    <div className="mt-page-content">
      <div className="mt-page-heading">
        <h1>Creator Hub</h1>
        <div className="mt-heading-actions">
          <a
            className="mt-pill outlined"
            href="https://academy.mindtrip.ai/"
            target="_blank"
            rel="noreferrer"
          >
            Creator Academy
          </a>
          <button
            className="mt-primary"
            type="button"
            onClick={() =>
              setEditing({ id: crypto.randomUUID(), title: "", description: "", placeIds: [] })
            }
          >
            Create guide
          </button>
        </div>
      </div>
      <section className="mt-creator-profile">
        <span className="mt-avatar">{username.charAt(0).toUpperCase()}</span>
        <div>
          <strong>{username}</strong>
          <small>My travel guides</small>
        </div>
        <Link className="mt-pill outlined" href="/profile">
          View profile
        </Link>
      </section>
      <section className="mt-creator-banner">
        <div>
          <h2>Create. Share. Earn</h2>
          <strong>Become a travel creator</strong>
          <p>
            Turn the places you love into a guide. Drafts stay in your workspace; publication and
            commissions are not connected.
          </p>
        </div>
        <BookOpen size={70} strokeWidth={1} />
      </section>
      <nav className="mt-tabs" aria-label="Creator views">
        {["Guides", "Commissions"].map((value) => (
          <button
            type="button"
            key={value}
            className={tab === value ? "selected" : ""}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </nav>
      {records.error && (
        <p className="mt-error" role="alert">
          {records.error}
        </p>
      )}
      {tab === "Guides" ? (
        <div className="mt-collection-grid">
          {records.items.map((guide) => (
            <button
              className="mt-collection-card"
              key={guide.id}
              type="button"
              onClick={() => setEditing(guide)}
            >
              <span>
                <BookOpen size={40} strokeWidth={1} />
              </span>
              <strong>{guide.title}</strong>
              <small>Private draft · {guide.placeIds.length} places</small>
            </button>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<BookOpen size={36} />}
          title="Your commissions"
          description="Creator payouts need a connected publisher and booking provider. No earnings are recorded."
        />
      )}
      {editing && (
        <Modal title="Edit guide" className="mt-tools-dialog" onClose={() => setEditing(null)}>
          <h2>
            {records.items.some((item) => item.id === editing.id) ? "Edit guide" : "Create guide"}
          </h2>
          <form
            className="mt-guide-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (
                records.save([editing, ...records.items.filter((item) => item.id !== editing.id)])
              ) {
                setEditing(null);
                setInfo("Guide saved as a private draft on this device.");
              }
            }}
          >
            <label>
              Title
              <input
                required
                maxLength={160}
                value={editing.title}
                onChange={(event) => setEditing({ ...editing, title: event.target.value })}
              />
            </label>
            <label>
              Introduction
              <textarea
                maxLength={5000}
                value={editing.description}
                onChange={(event) => setEditing({ ...editing, description: event.target.value })}
              />
            </label>
            <h3>Places</h3>
            <div className="mt-checkbox-list">
              {places.map((place) => (
                <label key={place.id}>
                  <input
                    type="checkbox"
                    checked={editing.placeIds.includes(place.id)}
                    onChange={() =>
                      setEditing({
                        ...editing,
                        placeIds: editing.placeIds.includes(place.id)
                          ? editing.placeIds.filter((id) => id !== place.id)
                          : [...editing.placeIds, place.id],
                      })
                    }
                  />
                  {place.name}
                </label>
              ))}
            </div>
            <div className="mt-dialog-footer">
              <button type="submit" className="mt-primary">
                Save draft
              </button>
            </div>
          </form>
        </Modal>
      )}
      {info && (
        <Modal title="Guide saved" className="mt-small-dialog" onClose={() => setInfo("")}>
          <h2>Guide saved</h2>
          <p>{info}</p>
        </Modal>
      )}
    </div>
  );
}
