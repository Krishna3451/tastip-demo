"use client";

import {
  DESTINATIONS,
  type Destination,
  destinationForDay,
  feedbackTasteSignals,
  getTripDestination,
  type Place,
  type TasteProfile,
  type TasteSeed,
  type Trip,
} from "@tastip/domain";
import { MapPin, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import { DestinationSearch } from "../planner/components/destination-search";
import { LodgingPanel } from "../planner/components/lodging-panel";
import { parseSavedPlaces } from "../planner/lib/saved-places";
import type { SavedCollection } from "../planner/lib/saved-workspace";
import { DiscoveryFavorites } from "./discovery-favorites";
import { PlaceCard } from "./home";
import type { Command } from "./itinerary";
import { EmptyState, Modal } from "./primitives";

const MapView = dynamic(() => import("../planner/components/leaflet-map"), {
  ssr: false,
  loading: () => (
    <p className="mt-map-loading" role="status">
      Opening map…
    </p>
  ),
});
const CATEGORIES = [
  ["", "For you"],
  ["restaurant", "Restaurants"],
  ["experience", "Experiences"],
  ["stay", "Stays"],
  ["location", "Locations"],
  ["guide", "Guides"],
] as const;
const TYPES: { id: Place["category"]; label: string }[] = [
  { id: "cafe", label: "Cafés" },
  { id: "food", label: "Restaurants" },
  { id: "culture", label: "Culture" },
  { id: "outdoors", label: "Outdoors" },
  { id: "shop", label: "Shops" },
];

type Discovery = { context: string; places: Place[]; warnings: string[] };

export function ExploreWorkspace({
  city: initialCity,
  trip,
  tasteProfile,
  configured,
  onCommand,
  onTaste,
  onPlace,
  onSave,
  onAdd,
  savedIds,
  collection,
  onCollectionAdd,
  onCollectionBack,
}: {
  city: Destination;
  trip: Trip | null;
  tasteProfile?: TasteProfile;
  configured: boolean;
  onCommand: Command;
  onTaste: () => void;
  onPlace: (place: Place, destination: Destination) => void;
  onSave: (place: Place, destination: Destination) => void;
  onAdd: (place: Place) => void;
  savedIds: string[];
  collection?: SavedCollection;
  onCollectionAdd?: (place: Place, destination: Destination) => void;
  onCollectionBack?: () => void;
}) {
  const providerFetch = useProviderFetch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const collectionContext = searchParams.has("collection");
  function categoryUrl(value: string) {
    const params = new URLSearchParams(searchParams);
    if (value) params.set("type", value);
    else params.delete("type");
    return `/explore${params.size ? `?${params}` : ""}`;
  }
  const category =
    CATEGORIES.find(([value]) => value === searchParams.get("type")) ?? CATEGORIES[0];
  const [city, setCity] = useState(initialCity);
  const [query, setQuery] = useState("");
  const [filters, setFilters] = useState(false);
  const [types, setTypes] = useState<Place["category"][]>([]);
  const [draftTypes, setDraftTypes] = useState<Place["category"][]>([]);
  const [cityOpen, setCityOpen] = useState(false);
  const [favoritesOpen, setFavoritesOpen] = useState(false);
  const [favorites, setFavorites] = useState<TasteSeed[] | null>(null);
  const seeds = favorites ?? tasteProfile?.seeds ?? [];
  const [radius, setRadius] = useState(8000);
  const [mapVisible, setMapVisible] = useState(true);
  const [shown, setShown] = useState(12);
  const [discovery, setDiscovery] = useState<Discovery | null>(null);
  const [pendingContext, setPendingContext] = useState("");
  const [feedback, setFeedback] = useState<{
    context: string;
    message: string;
    error?: boolean;
  } | null>(null);
  const request = useRef<AbortController | null>(null);
  const excludedIds = trip ? feedbackTasteSignals(trip).excludedIds : [];
  const context = JSON.stringify([
    city,
    seeds.map((seed) => seed.id),
    radius,
    trip?.id,
    excludedIds,
  ]);
  const currentContext = useRef(context);
  currentContext.current = context;
  const busy = pendingContext === context;
  const loaded = discovery?.context === context ? discovery : null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: A changed discovery context must cancel the previous request.
  useEffect(() => {
    request.current?.abort();
    setPendingContext("");
    return () => request.current?.abort();
  }, [context]);
  // A context check also gates rendering before effect cleanup runs.
  const candidates =
    loaded?.places ??
    (trip?.places ?? []).filter(
      (place) =>
        (place.destinationId ?? trip?.brief.destinationId) === city.id &&
        !excludedIds.includes(place.id),
    );
  const places = candidates.filter(
    (place) =>
      `${place.name} ${place.description}`.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!types.length || types.includes(place.category)) &&
      (category[0] === "" ||
        (category[0] === "restaurant"
          ? ["cafe", "food"].includes(place.category)
          : category[0] === "experience" && !["cafe", "food"].includes(place.category))),
  );
  const visible = places.slice(0, shown);
  const markers = useMemo(
    () =>
      visible
        .filter((place) => place.source === "qloo")
        .map((place) => ({ stopId: place.id, place })),
    [visible],
  );
  const select = useCallback(
    (id: string) => {
      const place = markers.find((item) => item.stopId === id)?.place;
      if (place) onPlace(place, city);
    },
    [markers, onPlace, city],
  );
  const cityChoices = [
    ...new Map(
      [
        initialCity,
        ...(trip?.route?.stays
          .map((stay) => getTripDestination(trip, stay.destinationId))
          .filter((item): item is Destination => Boolean(item)) ?? []),
        ...DESTINATIONS,
      ].map((item) => [item.id, item]),
    ).values(),
  ];
  const lodgingDay = trip?.days.find((day) => destinationForDay(trip, day.id) === city.id);
  const browsingPlaces = ["", "restaurant", "experience"].includes(category[0]);

  async function find() {
    if (!seeds.length) {
      setFavoritesOpen(true);
      return;
    }
    if (!configured) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setPendingContext(context);
    setFeedback(null);
    try {
      const response = await providerFetch("/api/taste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entityIds: seeds.map((seed) => seed.id),
          destinationId: city.id,
          destination: city,
          radiusMetres: radius,
          take: 50,
          excludedIds,
        }),
        signal: controller.signal,
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "Places could not load. Try again.");
      const records = parseSavedPlaces(
        JSON.stringify(
          Array.isArray(body.selected)
            ? body.selected.map((place: unknown) => ({ place, destination: city }))
            : null,
        ),
      );
      if (!records || records.some(({ place }) => place.source !== "qloo" || !place.taste))
        throw new Error("The place response could not be verified. Try again.");
      if (controller.signal.aborted || currentContext.current !== context) return;
      setDiscovery({
        context,
        places: records.map(({ place }) => place),
        warnings: Array.isArray(body.warnings)
          ? body.warnings
              .filter((value: unknown): value is string => typeof value === "string")
              .slice(0, 10)
          : [],
      });
      setShown(12);
    } catch (cause) {
      if (!controller.signal.aborted && currentContext.current === context)
        setFeedback({
          context,
          error: true,
          message: cause instanceof Error ? cause.message : "Places could not load. Try again.",
        });
    } finally {
      if (!controller.signal.aborted && currentContext.current === context) setPendingContext("");
    }
  }
  function cancel() {
    request.current?.abort();
    setPendingContext("");
    setFeedback({ context, message: "Search stopped. Your trip is unchanged." });
  }
  return (
    <div className={`mt-explore-workspace ${mapVisible ? "" : "map-hidden"}`}>
      <section className="mt-explore-results" aria-label="Explore places">
        {collectionContext && (
          <section className="mt-discovery-collection" aria-label="Collection discovery">
            <button type="button" className="mt-pill outlined" onClick={onCollectionBack}>
              Back to collection
            </button>
            <h2>{collection ? `Add places to ${collection.name}` : "Collection unavailable"}</h2>
            <p>Choose + to keep a place in this collection. Your itinerary stays as it is.</p>
          </section>
        )}
        <header>
          <button
            type="button"
            className="mt-explore-city"
            aria-label={`Explore location: ${city.name}`}
            onClick={() => setCityOpen(true)}
          >
            {city.name}
            <MapPin size={17} />
          </button>
          <button
            type="button"
            className="mt-pill outlined mt-map-toggle"
            aria-pressed={mapVisible}
            onClick={() => setMapVisible(!mapVisible)}
          >
            {mapVisible ? "Hide map" : "Map"}
          </button>
        </header>
        <div className="mt-explore-search">
          <div className="mt-search">
            <Search size={17} />
            <input
              type="search"
              aria-label="Search loaded places"
              placeholder="Search loaded places"
              value={query}
              maxLength={200}
              onChange={(event) => {
                setQuery(event.target.value);
                setShown(12);
              }}
            />
          </div>
          <button
            type="button"
            className="mt-pill outlined"
            onClick={() => {
              setDraftTypes(types);
              setFilters(true);
            }}
          >
            <SlidersHorizontal size={16} />
            Filters{types.length > 0 ? ` ${types.length}` : ""}
          </button>
        </div>
        <nav className="mt-explore-categories" aria-label="Explore categories">
          {CATEGORIES.map(([value, name]) => (
            <button
              type="button"
              key={name}
              className={category[0] === value ? "selected" : ""}
              aria-pressed={category[0] === value}
              onClick={() => {
                setShown(12);
                router.push(categoryUrl(value), { scroll: false });
              }}
            >
              {name}
            </button>
          ))}
        </nav>
        {types.length > 0 && (
          <section className="mt-discovery-active-filters" aria-label="Active place filters">
            {types.map((type) => (
              <button
                type="button"
                className="mt-pill outlined"
                key={type}
                aria-label={`Remove ${TYPES.find((item) => item.id === type)?.label} filter`}
                onClick={() => {
                  setTypes(types.filter((item) => item !== type));
                  setShown(12);
                }}
              >
                {TYPES.find((item) => item.id === type)?.label}
                <X size={13} />
              </button>
            ))}
            <button
              type="button"
              className="mt-pill"
              onClick={() => {
                setTypes([]);
                setShown(12);
              }}
            >
              Clear filters
            </button>
          </section>
        )}
        {browsingPlaces && (
          <section className="mt-discovery-toolbar" aria-label="Personal recommendations">
            <div>
              <strong>Your kind of {city.name}</strong>
              <p>
                {seeds.length
                  ? `Based on ${seeds.length} confirmed favorite${seeds.length === 1 ? "" : "s"}.`
                  : "Choose a few cultural favorites to find places for you."}
              </p>
            </div>
            <div className="mt-discovery-actions">
              <button
                type="button"
                className="mt-pill outlined"
                onClick={() => setFavoritesOpen(true)}
              >
                {seeds.length ? "Edit favorites" : "Choose favorites"}
              </button>
              <label>
                Search radius
                <select
                  aria-label="Recommendation radius"
                  value={radius}
                  onChange={(event) => setRadius(Number(event.target.value))}
                >
                  <option value={2000}>2 km</option>
                  <option value={8000}>8 km</option>
                  <option value={20000}>20 km</option>
                  <option value={50000}>50 km</option>
                </select>
              </label>
              {busy ? (
                <button type="button" className="mt-pill outlined" onClick={cancel}>
                  Stop search
                </button>
              ) : (
                <button
                  type="button"
                  className="mt-primary"
                  disabled={!configured && seeds.length > 0}
                  onClick={() => void find()}
                >
                  <RefreshCw size={15} />
                  {loaded ? "Refresh places" : "Find places"}
                </button>
              )}
            </div>
            {!configured && (
              <p className="mt-muted">Personal recommendations are unavailable right now.</p>
            )}
            {feedback?.context === context && (
              <p role={feedback.error ? "alert" : "status"}>
                {feedback.message}
                {feedback.error && (
                  <button type="button" className="mt-pill outlined" onClick={() => void find()}>
                    Retry search
                  </button>
                )}
              </p>
            )}
            {Boolean(loaded?.warnings.length) && (
              <p className="mt-muted">Some results were unavailable and have been left out.</p>
            )}
          </section>
        )}
        <h2>{category[0] === "" ? "Places for you" : category[1]}</h2>
        {category[0] === "stay" && collectionContext ? (
          <EmptyState
            icon={<MapPin size={35} />}
            title="Collection stays are not available yet"
            description="Choose For you or Restaurants to save Qloo places to this collection. Plan lodging separately from your trip."
          />
        ) : category[0] === "stay" && trip && lodgingDay ? (
          <LodgingPanel
            dayId={lodgingDay.id}
            trip={trip}
            configured={configured}
            onCommand={onCommand}
            onTaste={onTaste}
          />
        ) : category[0] === "location" ? (
          <div className="mt-discovery-locations">
            {cityChoices.map((destination) => (
              <button
                type="button"
                className="mt-pill outlined"
                key={destination.id}
                onClick={() => {
                  setCity(destination);
                  router.push(categoryUrl(""), { scroll: false });
                }}
              >
                <MapPin size={16} />
                {destination.name}, {destination.country}
              </button>
            ))}
          </div>
        ) : category[0] === "guide" ? (
          <EmptyState
            icon={<MapPin size={35} />}
            title="No sourced guides yet"
            description="Saved guides will appear here when a guide source is connected."
          />
        ) : category[0] === "stay" ? (
          <EmptyState
            icon={<MapPin size={35} />}
            title="Plan a stay in this city"
            description="Add this city to your trip to find and review lodging ideas."
          />
        ) : busy ? (
          <div className="mt-discovery-loading" role="status">
            <p>Finding places around {city.name}…</p>
            <div className="mt-discovery-skeletons" aria-hidden="true">
              {[1, 2, 3, 4].map((item) => (
                <span key={item} />
              ))}
            </div>
          </div>
        ) : places.length ? (
          <>
            <p className="mt-muted mt-discovery-count" role="status">
              Showing {visible.length} of {places.length} loaded places
              {loaded ? " · Ranked by Qloo" : " · From your trip"}
            </p>
            <div className="mt-place-grid">
              {visible.map((place) => (
                <PlaceCard
                  key={place.id}
                  place={place}
                  saved={savedIds.includes(place.id)}
                  onSave={() => onSave(place, city)}
                  onOpen={() => onPlace(place, city)}
                  onAdd={() => (collectionContext ? onCollectionAdd?.(place, city) : onAdd(place))}
                  addLabel={
                    collectionContext
                      ? collection?.placeIds.includes(place.id)
                        ? `${place.name} is in ${collection.name}`
                        : `Add ${place.name} to ${collection?.name ?? "collection"}`
                      : undefined
                  }
                  added={
                    collectionContext && (!collection || collection.placeIds.includes(place.id))
                  }
                />
              ))}
            </div>
            {shown < places.length && (
              <button
                type="button"
                className="mt-pill outlined mt-discovery-more"
                onClick={() => setShown(shown + 12)}
              >
                Show more places
              </button>
            )}
          </>
        ) : (
          <EmptyState
            icon={<MapPin size={35} />}
            title={
              query || types.length
                ? "No matching places"
                : loaded
                  ? "No places found here"
                  : "Find your kind of places"
            }
            description={
              query || types.length
                ? "Search only checks loaded places. Try another name or clear your filters."
                : loaded
                  ? "Try a wider radius or different favorites."
                  : "Find personal suggestions without changing your itinerary."
            }
            action={
              <button
                type="button"
                className="mt-primary"
                disabled={!configured && seeds.length > 0}
                onClick={() => void find()}
              >
                Find places
              </button>
            }
          />
        )}
      </section>
      {mapVisible && (
        <aside className="mt-explore-map" aria-label="Explore map">
          <MapView
            destination={city}
            places={busy || !browsingPlaces ? [] : markers}
            route={null}
            onSelect={select}
            label={`Map of loaded places in ${city.name}`}
          />
        </aside>
      )}
      {filters && (
        <Modal title="Filters" onClose={() => setFilters(false)} className="mt-picker-dialog">
          <h2>Filters</h2>
          <h3>Type of place</h3>
          <p className="mt-muted">
            Filter the places already loaded. Their original recommendation order is preserved.
          </p>
          <div className="mt-setup-chips">
            {TYPES.map(({ id, label }) => (
              <button
                type="button"
                key={id}
                aria-pressed={draftTypes.includes(id)}
                onClick={() =>
                  setDraftTypes(
                    draftTypes.includes(id)
                      ? draftTypes.filter((item) => item !== id)
                      : [...draftTypes, id],
                  )
                }
              >
                {label}
              </button>
            ))}
          </div>
          <div className="mt-dialog-footer">
            <button type="button" className="mt-pill outlined" onClick={() => setDraftTypes([])}>
              Clear
            </button>
            <button
              type="button"
              className="mt-primary"
              onClick={() => {
                setTypes(draftTypes);
                setShown(12);
                setFilters(false);
              }}
            >
              Show places
            </button>
          </div>
        </Modal>
      )}
      {cityOpen && (
        <Modal
          title="Explore location"
          onClose={() => setCityOpen(false)}
          className="mt-picker-dialog"
        >
          <h2>Explore somewhere</h2>
          <p className="mt-muted">Changing where you browse keeps your trip as it is.</p>
          <div className="mt-setup-chips">
            {cityChoices.map((destination) => (
              <button
                type="button"
                key={destination.id}
                aria-pressed={destination.id === city.id}
                onClick={() => {
                  setCity(destination);
                  setShown(12);
                  setCityOpen(false);
                }}
              >
                {destination.name}
              </button>
            ))}
          </div>
          <DestinationSearch
            value={city}
            label="Search another destination"
            onSelect={(destination) => {
              setCity(destination);
              setShown(12);
              setCityOpen(false);
            }}
          />
        </Modal>
      )}
      {favoritesOpen && (
        <DiscoveryFavorites
          initial={seeds}
          configured={configured}
          onClose={() => setFavoritesOpen(false)}
          onConfirm={(next) => {
            setFavorites(next);
            setFavoritesOpen(false);
          }}
        />
      )}
    </div>
  );
}
