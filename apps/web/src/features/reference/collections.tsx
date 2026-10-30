"use client";

import {
  DESTINATIONS,
  type Destination,
  getTripDestination,
  type Place,
  type Trip,
} from "@tastip/domain";
import {
  BriefcaseBusiness,
  CalendarDays,
  Heart,
  Plus,
  Receipt,
  Search,
  Upload,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { tripTitle } from "../planner/lib/travel-pack";
import { CITY_IMAGES, DestinationCard, PlaceCard } from "./home";
import { EmptyState, Modal, Toggle } from "./primitives";

export function TripsIndex({
  trips,
  onCreate,
  onOpen,
  tab = "Trips",
  onAccountSaves,
}: {
  trips: Trip[];
  onCreate: () => void;
  onOpen: (trip: Trip) => void;
  tab?: string;
  onAccountSaves: () => void;
}) {
  const [receiptInfo, setReceiptInfo] = useState(false);
  const [booked, setBooked] = useState(false);
  const [filter, setFilter] = useState("All");
  const shown = booked
    ? []
    : trips.filter(
        (trip) =>
          filter === "All" ||
          (filter === "Upcoming"
            ? Boolean(
                trip.route?.startDate &&
                  trip.route.startDate >= new Date().toISOString().slice(0, 10),
              )
            : !trip.route?.startDate),
      );
  return (
    <div className="mt-page-content">
      {receiptInfo && (
        <Modal
          title="Upload a receipt"
          onClose={() => setReceiptInfo(false)}
          className="mt-small-dialog"
        >
          <h2>Upload a receipt</h2>
          <p>
            Receipt uploads and extraction need a connected storage provider. No file has been
            uploaded.
          </p>
        </Modal>
      )}
      <div className="mt-page-heading">
        <h1>{tab === "Receipts" ? "Your receipts" : "Your trips"}</h1>
        {tab === "Receipts" ? (
          <button type="button" className="mt-primary" onClick={() => setReceiptInfo(true)}>
            <Upload size={17} />
            Upload
          </button>
        ) : (
          <button className="mt-primary" type="button" onClick={onCreate}>
            <Plus size={19} />
            New trip
          </button>
        )}
      </div>
      <nav className="mt-tabs" aria-label="Trips views">
        {[
          ["Trips", "/trips"],
          ["Calendar", "/calendar"],
          ["Receipts", "/receipts"],
        ].map(([label, href]) => (
          <Link href={href!} key={label} className={tab === label ? "selected" : ""}>
            {label}
          </Link>
        ))}
      </nav>
      {tab === "Trips" ? (
        <>
          <div className="mt-collection-filter">
            <div className="mt-booked-filter">
              <Toggle checked={booked} onChange={setBooked} label="Booked only" />
              Booked only
            </div>
            <select
              aria-label="Trip view"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            >
              <option>All</option>
              <option>Upcoming</option>
              <option>Unscheduled</option>
            </select>
          </div>
          {shown.length ? (
            <>
              <h2 className="mt-collection-subheading">
                {filter === "All"
                  ? shown.every((trip) => !trip.route?.startDate)
                    ? "Unscheduled"
                    : "Your plans"
                  : filter}
              </h2>
              <div className="mt-trip-grid">
                {shown.map((trip) => (
                  <button
                    type="button"
                    key={trip.id}
                    className="mt-trip-card"
                    onClick={() => onOpen(trip)}
                  >
                    <div className="mt-trip-cover">
                      {CITY_IMAGES[trip.brief.destinationId] ? (
                        <img src={CITY_IMAGES[trip.brief.destinationId]} alt="" loading="lazy" />
                      ) : (
                        <BriefcaseBusiness size={38} />
                      )}
                    </div>
                    <div className="mt-trip-card-caption">
                      <h2>{tripTitle(trip)}</h2>
                      <p>
                        {Array.from(
                          new Set(
                            (
                              trip.route?.stays.map((stay) => stay.destinationId) ?? [
                                trip.brief.destinationId,
                              ]
                            )
                              .map((id) => getTripDestination(trip, id)?.country)
                              .filter(Boolean),
                          ),
                        ).join(", ")}{" "}
                        · {trip.days.length} days
                        {trip.route?.startDate
                          ? ` · ${new Date(`${trip.route.startDate}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })}`
                          : trip.brief.details?.flexibleMonths?.length
                            ? ` in ${trip.brief.details.flexibleMonths.map((month) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" })).join(" / ")}`
                            : " · Unscheduled"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            </>
          ) : (
            <EmptyState
              icon={<BriefcaseBusiness size={40} />}
              title={booked ? "No booked trips yet" : "Your next adventure starts here"}
              description={
                booked
                  ? "Confirmed bookings will appear here when a booking provider is connected."
                  : "Create a trip and keep all your ideas and plans in one place."
              }
              action={
                <button type="button" className="mt-primary" onClick={onCreate}>
                  <Plus size={17} />
                  New trip
                </button>
              }
            />
          )}
          <button
            type="button"
            className="mt-pill outlined mt-account-saves"
            onClick={onAccountSaves}
          >
            Account trips & backups
          </button>
        </>
      ) : tab === "Calendar" ? (
        <>
          <div className="mt-calendar-collection">
            {shown
              .filter((trip) => trip.route)
              .map((trip) => (
                <button type="button" key={trip.id} onClick={() => onOpen(trip)}>
                  <CalendarDays size={25} />
                  <span>
                    <strong>{tripTitle(trip)}</strong>
                    <small>
                      {trip.route?.startDate} · {trip.days.length} days
                    </small>
                  </span>
                </button>
              ))}
          </div>
          {!shown.some((trip) => trip.route) && (
            <EmptyState
              icon={<CalendarDays size={40} />}
              title="Your travel calendar"
              description="Add dates to a trip to see your plans here."
              action={
                <button className="mt-primary" type="button" onClick={onCreate}>
                  Plan a trip
                </button>
              }
            />
          )}
        </>
      ) : (
        <EmptyState
          icon={<Receipt size={40} />}
          title="All your receipts, in one place"
          description="Receipt import needs a connected booking or upload provider."
        />
      )}
    </div>
  );
}

export function SavedIndex({
  places,
  savedIds,
  onSave,
  onPlace,
  onAdd,
}: {
  places: Place[];
  savedIds: string[];
  onSave: (place: Place) => void;
  onPlace: (place: Place) => void;
  onAdd: (place: Place) => void;
}) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("All");
  const shown = places.filter(
    (place) =>
      place.name.toLowerCase().includes(query.toLowerCase()) &&
      (tab === "All" ||
        (tab === "Eats"
          ? ["cafe", "food"].includes(place.category)
          : !["cafe", "food"].includes(place.category))),
  );
  return (
    <div className="mt-page-content">
      <div className="mt-page-heading">
        <h1>Saved</h1>
      </div>
      <div className="mt-search mt-saved-search">
        <Search size={19} />
        <input
          aria-label="Search saved places"
          placeholder="Search saved places"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <nav className="mt-tabs" aria-label="Saved categories">
        {["All", "Eats", "Experiences"].map((value) => (
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
      {shown.length ? (
        <div className="mt-place-grid">
          {shown.map((place) => (
            <PlaceCard
              key={place.id}
              place={place}
              saved={savedIds.includes(place.id)}
              onSave={() => onSave(place)}
              onOpen={() => onPlace(place)}
              onAdd={() => onAdd(place)}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={<Heart size={40} />}
          title={query ? "No matching places" : "Keep the places you love"}
          description={
            query
              ? "Try another search or category."
              : "Tap the heart on a place to save it for later."
          }
          action={
            <Link href="/explore" className="mt-primary">
              Explore places
            </Link>
          }
        />
      )}
    </div>
  );
}

export function Inspiration({ onCity: _onCity }: { onCity: (city: Destination) => void }) {
  const [query, setQuery] = useState("");
  const [searched, setSearched] = useState(false);
  return (
    <div className="mt-page-content">
      <div className="mt-page-heading">
        <h1>Inspiration</h1>
      </div>
      <form
        className="mt-search mt-inspiration-search"
        onSubmit={(event) => {
          event.preventDefault();
          setSearched(true);
        }}
      >
        <Search size={18} />
        <input
          aria-label="Search for location or handle"
          placeholder="Search for location or handle"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSearched(false);
          }}
        />
        <button type="submit" className="mt-icon" aria-label="Search">
          <Search size={18} />
        </button>
      </form>
      <h2 className="mt-collection-subheading">
        {searched ? "Search results" : "Featured guides"}
      </h2>
      {searched && (
        <p className="mt-muted" role="status">
          No published guides are available for “{query}”. Guide drafts can be created in the
          Creator Hub.
        </p>
      )}
    </div>
  );
}
