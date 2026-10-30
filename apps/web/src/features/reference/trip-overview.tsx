"use client";

import { briefDestination, getTripDestination, type Place, type Trip } from "@tastip/domain";
import {
  ArrowLeft,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  Download,
  File,
  Info,
  Lightbulb,
  MoreHorizontal,
  Settings2,
  Share2,
  Undo2,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { Conversation } from "../planner/lib/conversations";
import { tripTitle } from "../planner/lib/travel-pack";
import { EntryComposer } from "./composer";
import { AssistantMark } from "./primitives";

const TripMap = dynamic(() => import("../planner/components/leaflet-map"), {
  ssr: false,
  loading: () => <p role="status">Opening map…</p>,
});
type TripSection =
  | "ideas"
  | "itinerary"
  | "bookings"
  | "media"
  | "preferences"
  | "calendar"
  | "route"
  | "share"
  | "pack"
  | "find";

export function TripOverview({
  trip,
  chats,
  username,
  onPanel,
  onTitleEdit,
  onPlace,
  onSubmit,
  onVoice,
  onNewChat,
  canUndo,
  onUndo,
}: {
  trip: Trip;
  chats: Conversation[];
  username?: string;
  onPanel: (panel: TripSection) => void;
  onTitleEdit: () => void;
  onPlace: (place: Place) => void;
  onSubmit: (text: string) => void;
  onVoice: () => void;
  onNewChat: () => void;
  canUndo: boolean;
  onUndo: () => void;
}) {
  const [suggestion, setSuggestion] = useState(true);
  const [more, setMore] = useState(false);
  const ownChats = chats
    .filter((chat) => chat.tripId === trip.id && !chat.archived)
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const countries = [
    ...new Set(
      (trip.route?.stays.map((stay) => stay.destinationId) ?? [trip.brief.destinationId])
        .map((id) => getTripDestination(trip, id)?.country)
        .filter(Boolean),
    ),
  ].join(" / ");
  const months = trip.brief.details?.flexibleMonths?.map((month) =>
    new Date(`${month}-01T12:00:00Z`).toLocaleDateString("en", { month: "short", timeZone: "UTC" }),
  );
  const dateLabel = trip.route?.startDate
    ? `${new Date(`${trip.route.startDate}T12:00:00Z`).toLocaleDateString("en", { month: "short", day: "numeric", timeZone: "UTC" })} · ${trip.days.length} days`
    : `${trip.days.length} days${months?.length ? ` in ${months.join(" / ")}` : " · Flexible"}`;
  const points = useMemo(
    () =>
      trip.stops.flatMap((stop) => {
        const place = trip.places.find((item) => item.id === stop.placeId);
        return place?.source === "qloo" ? [{ stopId: stop.id, place }] : [];
      }),
    [trip],
  );
  const selectPoint = useCallback(
    (id: string) => {
      const place = points.find((point) => point.stopId === id)?.place;
      if (place) onPlace(place);
    },
    [points, onPlace],
  );
  const ideas = trip.places.filter(
    (place) => !trip.stops.some((stop) => stop.placeId === place.id),
  ).length;
  const sections = [
    ["Ideas", Lightbulb, "ideas", ideas],
    ["Itinerary", ClipboardList, "itinerary", trip.stops.length],
    ["Bookings", CalendarCheck, "bookings", trip.lodgings?.length ?? 0],
    ["Media", File, "media", trip.media?.length ?? 0],
    ["Trip preferences", Info, "preferences", trip.brief.details?.request ? 1 : 0],
    ["Calendar", CalendarDays, "calendar", trip.stops.length],
  ] as const;
  return (
    <>
      <header className="mt-trip-toolbar">
        <Link className="mt-icon" aria-label="All trips" href="/trips">
          <ArrowLeft size={19} />
        </Link>
        <div>
          <button type="button" className="mt-trip-invite" onClick={() => onPanel("share")}>
            <span className="mt-avatar">{username?.charAt(0).toUpperCase() ?? "G"}</span>Invite
          </button>
          <button
            type="button"
            className="mt-icon"
            aria-label="Share"
            onClick={() => onPanel("share")}
          >
            <Share2 size={18} />
          </button>
          <div className="mt-trip-more">
            <button
              type="button"
              className="mt-icon"
              aria-label="More trip options"
              aria-expanded={more}
              onClick={() => setMore(!more)}
            >
              <MoreHorizontal size={19} />
            </button>
            {more && (
              <div role="menu" aria-label="Trip options">
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMore(false);
                    onTitleEdit();
                  }}
                >
                  <Settings2 size={15} />
                  Edit trip title
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMore(false);
                    onPanel("route");
                  }}
                >
                  Edit dates & cities
                </button>
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setMore(false);
                    onPanel("pack");
                  }}
                >
                  <Download size={15} />
                  Download travel pack
                </button>
                {canUndo && (
                  <button
                    role="menuitem"
                    type="button"
                    onClick={() => {
                      setMore(false);
                      onUndo();
                    }}
                  >
                    <Undo2 size={15} />
                    Undo last change
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>
      <div className="mt-reference-trip">
        <section className="mt-trip-planning" aria-label="Trip overview">
          <button type="button" className="mt-editable-title" onClick={onTitleEdit}>
            <h1>{tripTitle(trip)}</h1>
          </button>
          <div className="mt-trip-summary">
            <button type="button" onClick={() => onPanel("route")}>
              {countries || briefDestination(trip.brief)?.name}
            </button>
            <button type="button" onClick={() => onPanel("route")}>
              {dateLabel}
            </button>
            <button type="button" onClick={() => onPanel("preferences")}>
              {trip.brief.partySize} {trip.brief.partySize === 1 ? "traveler" : "travelers"}
            </button>
            {trip.brief.budget !== null && (
              <button type="button" onClick={() => onPanel("preferences")}>
                {trip.brief.currency} {trip.brief.budget}
              </button>
            )}
          </div>
          {suggestion && (
            <section className="mt-trip-suggestion">
              <AssistantMark small />
              <p>
                {trip.stops.length
                  ? `Your ${trip.days.length}-day trip is taking shape. Want to explore a few more places or fine-tune your days?`
                  : "A few favorite places can be the start of a great trip. Want to find ideas and shape your days?"}
              </p>
              <div>
                <button type="button" className="mt-pill" onClick={() => onPanel("find")}>
                  Find ideas
                </button>
                <button type="button" className="mt-pill" onClick={() => onPanel("itinerary")}>
                  Shape the days
                </button>
                <button
                  type="button"
                  className="mt-pill outlined"
                  aria-label="Hide suggestion"
                  onClick={() => setSuggestion(false)}
                >
                  Dismiss
                </button>
              </div>
            </section>
          )}
          <div className="mt-trip-chat-heading">
            <h2>
              Chats <small>{ownChats.length}</small>
            </h2>
            <button className="mt-text-action" type="button" onClick={onNewChat}>
              New chat
            </button>
          </div>
          <div className="mt-trip-chat-cards">
            {ownChats.map((chat) => (
              <Link key={chat.id} href={`/chat/${chat.id}`}>
                <span>
                  <strong>{chat.title}</strong>
                  <small>
                    {new Date(chat.updatedAt).toLocaleDateString("en", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                    })}
                  </small>
                </span>
                <ChevronRight size={22} />
              </Link>
            ))}
            {!ownChats.length && (
              <p className="mt-muted">Ask your first question to start planning this trip.</p>
            )}
          </div>
          <EntryComposer
            placeholder="Start a new chat for this trip"
            onSubmit={onSubmit}
            onVoice={onVoice}
            onAttach={() => onPanel("media")}
          />
        </section>
        <section className="mt-trip-workspace" aria-label="Trip workspaces">
          <div className="mt-trip-workspace-buttons">
            {sections.map(([title, Icon, id, count]) => (
              <button type="button" key={id} onClick={() => onPanel(id)}>
                <Icon size={21} strokeWidth={1.6} />
                <strong>{title}</strong>
                {count > 0 && <small>{count}</small>}
              </button>
            ))}
          </div>
          <div className="mt-trip-overview-map">
            <TripMap
              places={points}
              destination={briefDestination(trip.brief)}
              route={null}
              onSelect={selectPoint}
              label="Map of this trip’s places"
            />
          </div>
        </section>
      </div>
    </>
  );
}
