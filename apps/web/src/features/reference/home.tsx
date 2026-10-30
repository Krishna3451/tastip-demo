"use client";

import {
  briefDestination,
  DESTINATIONS,
  type Destination,
  type Place,
  type Trip,
} from "@tastip/domain";
import {
  ArrowRight,
  BedDouble,
  BriefcaseBusiness,
  Check,
  ChevronLeft,
  ChevronRight,
  Heart,
  MapPin,
  Plane,
  Plus,
  Sparkles,
  Ticket,
  Utensils,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";
import { AssistantMark, Toggle } from "./primitives";

export const CITY_IMAGES: Record<string, string> = {
  lisbon:
    "https://images.unsplash.com/photo-1555881400-74d7acaacd8b?auto=format&fit=crop&w=900&q=85",
  porto:
    "https://images.unsplash.com/photo-1555881400-69a2384ed615?auto=format&fit=crop&w=900&q=85",
  kyoto:
    "https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?auto=format&fit=crop&w=900&q=85",
  copenhagen:
    "https://images.unsplash.com/photo-1513622470522-26c3c8a854bc?auto=format&fit=crop&w=900&q=85",
};
export const CATEGORIES = [
  ["Stays", BedDouble, "purple"],
  ["Flights", Plane, "blue"],
  ["Eats", Utensils, "amber"],
  ["Experiences", Sparkles, "green"],
  ["Events", Ticket, "violet"],
  ["Trips", BriefcaseBusiness, "teal"],
] as const;

export function Categories({ onSelect }: { onSelect: (category: string) => void }) {
  return (
    <div className="mt-categories">
      {CATEGORIES.map(([name, Icon, color]) => (
        <button type="button" key={name} onClick={() => onSelect(name)}>
          <span className={color}>
            <Icon size={20} strokeWidth={1.6} />
          </span>
          {name}
        </button>
      ))}
    </div>
  );
}

export function PlaceCard({
  place,
  saved,
  onSave,
  onOpen,
  onAdd,
  addLabel,
  added = false,
}: {
  place: Place;
  saved: boolean;
  onSave: () => void;
  onOpen: () => void;
  onAdd: () => void;
  addLabel?: string;
  added?: boolean;
}) {
  return (
    <article className="mt-place-card">
      <div className={`mt-card-image category-${place.category}`}>
        <button
          type="button"
          className="mt-card-image-link"
          onClick={onOpen}
          aria-label={`View ${place.name}`}
        >
          {place.facts?.imageUrl ? (
            <img
              src={place.facts.imageUrl}
              alt={place.name}
              loading="lazy"
              referrerPolicy="no-referrer"
            />
          ) : (
            <MapPin size={38} strokeWidth={1} />
          )}
        </button>
        <div className="mt-card-actions">
          <button
            type="button"
            className={`mt-icon ${saved ? "saved" : ""}`}
            aria-label={saved ? `Unsave ${place.name}` : `Save ${place.name}`}
            onClick={onSave}
          >
            <Heart size={18} fill={saved ? "currentColor" : "none"} />
          </button>
          <button
            type="button"
            className="mt-icon"
            aria-label={addLabel ?? `Add ${place.name} to trip`}
            disabled={added}
            onClick={onAdd}
          >
            {added ? <Check size={19} /> : <Plus size={19} />}
          </button>
        </div>
      </div>
      <button type="button" className="mt-card-name" onClick={onOpen}>
        {place.name}
      </button>
      <div className="mt-card-meta">
        <span>
          {place.category === "cafe"
            ? "Café"
            : place.category === "food"
              ? "Restaurant"
              : place.category === "culture"
                ? "Culture"
                : place.category}
        </span>
        <span>
          {place.source === "demo"
            ? "Fictional sample"
            : place.source === "traveler"
              ? "Your place"
              : "Via Qloo"}
        </span>
      </div>
    </article>
  );
}

export function DestinationCard({
  city,
  onSelect,
}: {
  city: Destination;
  onSelect: (city: Destination) => void;
}) {
  return (
    <button type="button" className="mt-destination-card" onClick={() => onSelect(city)}>
      <img src={CITY_IMAGES[city.id]} alt={`${city.name}, ${city.country}`} loading="lazy" />
      <span>
        <strong>{city.name}</strong>
        <small>{city.country}</small>
      </span>
    </button>
  );
}

export function Carousel({
  title,
  description,
  children,
  onRefine,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  onRefine?: () => void;
}) {
  const row = useRef<HTMLDivElement>(null);
  return (
    <section className="mt-feed-section">
      <div className="mt-section-heading">
        <div>
          <h2>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        <div>
          {onRefine && (
            <button className="mt-pill" type="button" onClick={onRefine}>
              Refine
            </button>
          )}
          <button
            type="button"
            className="mt-icon"
            aria-label={`Previous ${title}`}
            onClick={() => row.current?.scrollBy({ left: -600, behavior: "smooth" })}
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            className="mt-icon"
            aria-label={`Next ${title}`}
            onClick={() => row.current?.scrollBy({ left: 600, behavior: "smooth" })}
          >
            <ChevronRight size={18} />
          </button>
        </div>
      </div>
      <div className="mt-carousel" ref={row}>
        {children}
      </div>
    </section>
  );
}

export function HomeFeed({
  trip,
  onCreate,
  onTaste,
  onCity,
  onCategory,
  savedIds,
  onSave,
  onPlace,
  onAdd,
}: {
  trip: Trip | null;
  onCreate: () => void;
  onTaste: () => void;
  onCity: (city: Destination) => void;
  onCategory: (name: string) => void;
  savedIds: string[];
  onSave: (place: Place) => void;
  onPlace: (place: Place) => void;
  onAdd: (place: Place) => void;
}) {
  const [suggestion, setSuggestion] = useState(true);
  const [nearby, setNearby] = useState(true);
  const city = trip ? briefDestination(trip.brief) : DESTINATIONS[0];
  const live = trip?.places.filter((place) => place.source === "qloo") ?? [];
  return (
    <div className="mt-home-content">
      <Categories onSelect={onCategory} />
      {suggestion && (
        <section className="mt-home-suggestion">
          <AssistantMark />
          <h1>
            {trip
              ? `${city?.name ?? "Your trip"} is wide open for now. Shape the next few days.`
              : "Where are you dreaming of going?"}
          </h1>
          <div className="mt-suggestion-actions">
            <button
              type="button"
              className="mt-icon mt-filled"
              aria-label="View trip"
              onClick={onCreate}
            >
              <BriefcaseBusiness size={20} />
            </button>
            <button type="button" className="mt-pill" onClick={onCreate}>
              Build my trip
            </button>
            <button type="button" className="mt-pill" onClick={onTaste}>
              Find ideas
            </button>
            <button type="button" className="mt-pill outlined" onClick={() => setSuggestion(false)}>
              Dismiss
            </button>
          </div>
        </section>
      )}
      <section className="mt-feed-section mt-agents-section">
        <div className="mt-section-heading">
          <div>
            <h2>Agents working for you</h2>
            <p>What I’ve found so far and new agents you might like.</p>
          </div>
          <div>
            <Link className="mt-pill" href="/agents/manage">
              Manage
            </Link>
            <Link className="mt-icon mt-filled" href="/agents" aria-label="See all results">
              <ArrowRight size={20} />
            </Link>
          </div>
        </div>
        <div className="mt-agent-empty-card">
          <span className="mt-agent-emoji">✧</span>
          <div>
            <h3>A little help for your next adventure.</h3>
            <p>Create an agent to keep a travel idea in one place.</p>
          </div>
          <Link className="mt-pill outlined" href="/agents/manage">
            Create agent <Plus size={15} />
          </Link>
        </div>
      </section>
      <div className="mt-for-you">
        <h2>For you</h2>
        <div>
          <Toggle checked={nearby} onChange={setNearby} label="Include places nearby" />
          <button type="button" className="mt-pill" onClick={onTaste}>
            <MapPin size={16} />
            {city?.name ?? "Choose a place"}
          </button>
          <Link className="mt-pill outlined" href="/explore">
            Map
          </Link>
        </div>
      </div>
      {live.length > 0 && (
        <Carousel
          title="Places that feel like you"
          description="Suggestions based on your confirmed cultural favorites."
          onRefine={onTaste}
        >
          {live.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              saved={savedIds.includes(place.id)}
              onSave={() => onSave(place)}
              onOpen={() => onPlace(place)}
              onAdd={() => onAdd(place)}
            />
          ))}
        </Carousel>
      )}
      <Carousel
        title="Trip ideas"
        description="A whole world to explore. Where will you go next?"
        onRefine={onTaste}
      >
        {DESTINATIONS.map((destination) => (
          <DestinationCard key={destination.id} city={destination} onSelect={onCity} />
        ))}
      </Carousel>
      {!live.length && (
        <section className="mt-personalize-card">
          <AssistantMark small />
          <h2>Let’s make this more you.</h2>
          <p>Tell me about a few things you love. I’ll help you find your kind of places.</p>
          <button type="button" className="mt-primary" onClick={onTaste}>
            Find my kind of places <ArrowRight size={16} />
          </button>
        </section>
      )}
      <section className="mt-feed-section">
        <div className="mt-section-heading">
          <div>
            <h2>From our community</h2>
            <p>Guides by locals and travelers who know the place.</p>
          </div>
          <Link href="/inspiration" className="mt-pill outlined">
            See all guides <ArrowRight size={17} />
          </Link>
        </div>
        <p className="mt-muted">Your saved guides will appear here.</p>
      </section>
      <p className="mt-feed-end">That’s all I’ve got for you</p>
      <button type="button" className="mt-pill outlined mt-feedback" onClick={onTaste}>
        Tell me what you’d rather see
      </button>
    </div>
  );
}
