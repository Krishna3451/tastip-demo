"use client";

import {
  briefDestination,
  DESTINATIONS,
  feedbackTasteSignals,
  MAX_TRIP_DAYS,
  type TasteProfile,
  type TasteSeed,
  type Trip,
  type TripBrief,
  type TripRoute,
} from "@tastip/domain";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  Compass,
  FolderOpen,
  Globe2,
  Info,
  MapPin,
  MessageCircle,
  RotateCcw,
  Sparkles,
  UserRound,
  Users,
  X,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ProviderAccess, useProviderFetch } from "@/lib/provider-fetch";
import type { ConversationPlanningRequest } from "../reference/conversation-planning";
import { parseTravelProfile, type TravelProfile } from "../reference/onboarding";
import { useConversations } from "../reference/use-conversations";
import { useSettings } from "../reference/use-settings";
import { AccountDialog } from "./components/account-dialog";
import { CityRecommendations } from "./components/city-recommendations";
import { CostPlanner } from "./components/cost-planner";
import { DayExperience } from "./components/day-experience";
import { DestinationSearch } from "./components/destination-search";
import { GeographicPlan } from "./components/geographic-plan";
import { GoogleGlobe } from "./components/google-globe";
import { IdeasPanel } from "./components/ideas-panel";
import { ItineraryList } from "./components/journey";
import { LodgingPanel } from "./components/lodging-panel";
import { PlannerConversation } from "./components/planner-conversation";
import { PracticalChecks } from "./components/practical-checks";
import { QlooEvidence } from "./components/qloo-evidence";
import { RemoteTrips } from "./components/remote-trips";
import { RoutePlan } from "./components/route-plan";
import { StopDetail } from "./components/stop-detail";
import { TasteConnect } from "./components/taste-connect";
import { TasteDialog } from "./components/taste-dialog";
import { TravelPack } from "./components/travel-pack";
import { TravelCalendar } from "./components/trip-calendar";
import { TripDetails } from "./components/trip-details";
import { TripLibrary } from "./components/trip-library";
import { TripName } from "./components/trip-name";
import { TripPrompt } from "./components/trip-prompt";
import { VisitDialog } from "./components/visit-dialog";
import { entryTripReview } from "./lib/entry-trip-review";
import { tripSourceLabel } from "./lib/place-labels";
import { useMapsConfiguration } from "./lib/use-maps-configuration";
import { useAccount } from "./use-account";
import { usePlanner } from "./use-planner";

const TripGenerationReview = dynamic(
  () => import("../reference/trip-generation-review").then((module) => module.TripGenerationReview),
  { ssr: false, loading: () => <p role="status">Opening your trip review…</p> },
);

const ConversationPlanning = dynamic(
  () => import("../reference/conversation-planning").then((module) => module.ConversationPlanning),
  {
    ssr: false,
    loading: () => (
      <div className="status-toast" role="status">
        Opening your trip review…
      </div>
    ),
  },
);
const Globe = dynamic(() => import("@tastip/scene").then((module) => module.Globe), {
  ssr: false,
  loading: () => (
    <div className="globe-loading" role="status">
      Getting the world ready…
    </div>
  ),
});
const PLANNING_VIEWS = [
  ["journey", "Journey"],
  ["list", "List"],
  ["map", "Map"],
  ["ideas", "Ideas"],
  ["calendar", "Calendar"],
  ["stays", "Stays"],
  ["costs", "Costs"],
  ["details", "Trip details"],
  ["pack", "Travel pack"],
  ["saved", "Saved trips"],
] as const;
type PlanningView = (typeof PLANNING_VIEWS)[number][0];
const INTERESTS = ["Independent cafés", "Art & design", "Local food", "Nature", "Books & music"];

function Brand() {
  return (
    <span className="wordmark">
      <span className="brand-mark" aria-hidden="true">
        <Compass size={23} strokeWidth={1.7} />
      </span>
      tastip<span className="wordmark-period">.</span>
    </span>
  );
}

export function Planner() {
  return (
    <Suspense
      fallback={
        <main className="tastip-app">
          <div className="app-loading" role="status">
            Opening your travel space…
          </div>
        </main>
      }
    >
      <PlannerSession />
    </Suspense>
  );
}

function PlannerSession() {
  const identity = useAccount();
  return (
    <ProviderAccess accountId={identity.account?.id ?? null} ready={identity.ready}>
      <PlannerWorkspace identity={identity} />
    </ProviderAccess>
  );
}

function PlannerWorkspace({ identity }: { identity: ReturnType<typeof useAccount> }) {
  const searchParams = useSearchParams();
  const requestedDay = searchParams.getAll("day").length === 1 ? searchParams.get("day") : null;
  const requestedVisit =
    searchParams.getAll("visit").length === 1 ? searchParams.get("visit") : null;
  const appliedHandoff = useRef<string | null>(null);
  const providerFetch = useProviderFetch();
  const mapsConfiguration = useMapsConfiguration(identity.ready);
  const [accountOpen, setAccountOpen] = useState(false);
  const [heldPendingChatId, setHeldPendingChatId] = useState<string | null>(null);
  const planner = usePlanner(identity.account?.id ?? null, identity.ready);
  const {
    brief,
    setBrief,
    trip,
    hydrated,
    libraryKey,
    notice,
    setNotice,
    create,
    createFromPlaces,
    command,
    canUndo,
    undoLast,
    reset,
    openTrip,
  } = planner;
  const scope = identity.account?.id ?? "guest";
  const conversations = useConversations(scope, identity.ready);
  const preferences = useSettings(scope, identity.ready);
  const [profile, setProfile] = useState<TravelProfile | null>(null);
  const [plannerChatId, setPlannerChatId] = useState<string | null>(null);
  const [chatPlanning, setChatPlanning] = useState<ConversationPlanningRequest | null>(null);
  const chatTrigger = useRef<HTMLElement | null>(null);
  const headerChatTrigger = useRef<HTMLButtonElement>(null);
  const planBody = useRef<HTMLElement>(null);
  useEffect(() => {
    setProfile(null);
    if (!identity.ready) return;
    try {
      const stored = localStorage.getItem(`tastip.reference.profile:${scope}`);
      if (stored) setProfile(parseTravelProfile(JSON.parse(stored)));
    } catch {
      // An unreadable optional profile never becomes assistant memory.
    }
  }, [scope, identity.ready]);
  const [configured, setConfigured] = useState(false);
  const [qlooConfigured, setQlooConfigured] = useState(false);
  const [requiresSignIn, setRequiresSignIn] = useState(false);
  const [checkedProviderScope, setCheckedProviderScope] = useState<string | null>(null);
  const providerReady = identity.ready && checkedProviderScope === scope;
  const [dayId, setDayId] = useState("day-1");
  const [selectedStopId, setSelectedStopId] = useState<string | null>(null);
  const [view, setView] = useState<PlanningView>("journey");
  const [ideaSchedule, setIdeaSchedule] = useState<{
    tripId: string;
    dayId: string;
    startTime: string;
    durationMinutes: number;
  } | null>(null);
  useEffect(() => {
    if (
      ideaSchedule &&
      (view !== "ideas" || ideaSchedule.dayId !== dayId || ideaSchedule.tripId !== trip?.id)
    )
      setIdeaSchedule(null);
  }, [view, dayId, trip?.id, ideaSchedule]);
  const [dayFocused, setDayFocused] = useState(false);
  const [companionOpen, setCompanionOpen] = useState(false);
  const [savedOpen, setSavedOpen] = useState(false);
  const [openGeneration, setOpenGeneration] = useState(0);
  const [entryRoute, setEntryRoute] = useState<TripRoute | undefined>(undefined);
  const [chatOpen, setChatOpen] = useState(false);
  const [tasteOpen, setTasteOpen] = useState(false);
  const [entryPlanning, setEntryPlanning] = useState<{
    id: string;
    scope: string;
    tripId: string | null;
    version: number | null;
    brief: TripBrief;
    route: TripRoute;
  } | null>(null);
  const recommendationAction = useRef<{ find: () => void }>(null);
  const selectionTrigger = useRef<HTMLElement | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A session change closes overlays belonging to the previous private workspace.
  useEffect(() => {
    setAccountOpen(false);
    setSelectedStopId(null);
    setTasteOpen(false);
    setEntryPlanning(null);
    setChatOpen(false);
    setCompanionOpen(false);
    setSavedOpen(false);
    setDayFocused(false);
    setView("journey");
    setEntryRoute(undefined);
    setPlannerChatId(null);
    setChatPlanning(null);
  }, [identity.ready, identity.account?.id]);
  useEffect(() => {
    setConfigured(false);
    setQlooConfigured(false);
    setRequiresSignIn(false);
    setCheckedProviderScope(null);
    if (!identity.ready) return;
    const controller = new AbortController();
    providerFetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Provider access could not be checked.");
        return response.json();
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setConfigured(Boolean(body.providers?.openai));
        setQlooConfigured(Boolean(body.providers?.qloo));
        setRequiresSignIn(body.requiresSignIn === true);
        setCheckedProviderScope(scope);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [identity.ready, providerFetch, scope]);
  const destination = briefDestination(trip?.brief ?? brief) ?? DESTINATIONS[0]!;
  useEffect(() => {
    if (trip && !trip.days.some((day) => day.id === dayId)) setDayId(trip.days[0]?.id ?? "day-1");
  }, [trip, dayId]);
  const selectedStop = trip?.stops.find((stop) => stop.id === selectedStopId);
  const selectedDayId = selectedStop?.dayId;
  useEffect(() => {
    if (selectedDayId) setDayId(selectedDayId);
  }, [selectedDayId]);
  useEffect(() => {
    if (!hydrated || !trip || (!requestedDay && !requestedVisit)) {
      appliedHandoff.current = null;
      return;
    }
    const handoff = JSON.stringify([
      identity.account?.id ?? "guest",
      trip.id,
      requestedDay,
      requestedVisit,
    ]);
    if (appliedHandoff.current === handoff) return;
    appliedHandoff.current = handoff;
    const day = trip.days.find((item) => item.id === requestedDay);
    const visit = trip.stops.find(
      (item) => item.id === requestedVisit && trip.days.some((day) => day.id === item.dayId),
    );
    // URL hints select an existing day/visit only; they never create or edit a trip.
    if (requestedDay && !day) return;
    if (requestedVisit && (!visit || (day && visit.dayId !== day.id))) return;
    const nextDay = day?.id ?? visit?.dayId;
    if (!nextDay) return;
    setDayId(nextDay);
    setSelectedStopId(visit?.id ?? null);
    setView("journey");
    setDayFocused(true);
  }, [hydrated, trip, requestedDay, requestedVisit, identity.account?.id]);
  const chatParams = new URLSearchParams();
  if (trip) chatParams.set("trip", trip.id);
  chatParams.set("return", "planner");
  const chatDay = trip?.days.find((day) => day.id === dayId) ?? trip?.days[0];
  if (chatDay) chatParams.set("day", chatDay.id);
  const tripChat = trip
    ? [...conversations.items]
        .filter((chat) => chat.tripId === trip.id && !chat.archived)
        .sort((a, b) => b.updatedAt - a.updatedAt)[0]
    : undefined;
  const activeChat =
    conversations.items.find(
      (chat) =>
        chat.id === plannerChatId &&
        !chat.archived &&
        (trip ? chat.tripId === trip.id : !chat.tripId),
    ) ??
    tripChat ??
    (!trip ? conversations.items.find((chat) => !chat.tripId && !chat.archived) : undefined);
  const chatHref = `/chat/${activeChat?.id ?? "new"}?${chatParams}`;
  const conversationOpen = trip ? companionOpen : chatOpen;
  const closeConversation = useCallback(() => {
    setCompanionOpen(false);
    setChatOpen(false);
    requestAnimationFrame(() => {
      const trigger = chatTrigger.current;
      (trigger?.isConnected && trigger.getClientRects().length
        ? trigger
        : headerChatTrigger.current
      )?.focus({ preventScroll: true });
    });
  }, []);
  function openConversation(fresh = false) {
    if (!conversations.writable || !preferences.ready) {
      setNotice(conversations.error ?? "Your conversations are still opening.");
      return;
    }
    const next = fresh
      ? conversations.create(trip?.id)
      : (activeChat ?? conversations.create(trip?.id));
    if (!next) return;
    if (!conversationOpen)
      chatTrigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setPlannerChatId(next.id);
    setCompanionOpen(Boolean(trip));
    setChatOpen(!trip);
    if (trip && dayFocused && view === "journey")
      requestAnimationFrame(() => {
        if (window.matchMedia("(min-width: 1101px)").matches)
          planBody.current
            ?.querySelector<HTMLElement>('[aria-label="Your floating day journey"]')
            ?.scrollIntoView({
              block: "start",
              behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
                ? "instant"
                : "smooth",
            });
      });
  }
  function planFromConversation(prompt: string, chatId: string) {
    if (!conversations.writable) return;
    setChatPlanning({
      id: crypto.randomUUID(),
      scope: libraryKey,
      tripId: trip?.id ?? null,
      version: trip?.version ?? null,
      chatId,
      prompt: prompt.slice(0, 2000),
    });
  }
  const travelPreferences =
    preferences.ready && !preferences.error && preferences.settings.assistant.memory && profile
      ? JSON.stringify({
          firstName: profile.firstName,
          homeBase: profile.city?.name,
          companions: profile.companions,
          budget: profile.budget,
          lodging: profile.lodging,
          restaurants: profile.restaurants,
          dietary: profile.dietary,
          weekends: profile.weekends,
          notes: profile.notes,
        }).slice(0, 4000)
      : undefined;
  const chatAvailable = preferences.ready && !preferences.error && providerReady && !requiresSignIn;
  const chatUnavailableReason = preferences.error
    ? "Chat and voice are paused because saved preferences could not be read. Their stored copy has been kept."
    : !preferences.ready
      ? "Chat and voice are paused while your preferences are checked."
      : requiresSignIn
        ? "Sign in to chat, plan with Tastip and find your places."
        : "Chat and voice are paused while provider access is checked. Reload to retry if this continues.";
  const chatSignIn =
    requiresSignIn && preferences.ready && !preferences.error
      ? () => setAccountOpen(true)
      : undefined;
  function openTaste() {
    if (requiresSignIn) setAccountOpen(true);
    else if (providerReady) setTasteOpen(true);
  }
  const conversationPanel = (
    <PlannerConversation
      key={`${scope}:${activeChat?.id ?? "empty"}`}
      chat={activeChat}
      trip={trip}
      dayId={dayId}
      scope={scope}
      qlooConfigured={qlooConfigured}
      onSuggestionAdded={(addedDayId, stopId) => {
        setDayId(addedDayId);
        setDayFocused(true);
        setView("journey");
        setSelectedStopId(stopId);
        setNotice("Visit added to your day. Opening hours and travel still need checking.");
      }}
      open={conversationOpen}
      configured={configured}
      available={chatAvailable}
      unavailableReason={chatUnavailableReason}
      onSignIn={chatSignIn}
      autoSendInitialMessage={activeChat?.id !== heldPendingChatId}
      preferences={preferences.settings.assistant}
      travelPreferences={travelPreferences}
      error={conversations.error}
      fullChatHref={chatHref}
      onCommand={command}
      onMessagesChange={conversations.updateMessages}
      onConsumePending={(id) => {
        conversations.consumePending(id);
      }}
      onPlanTrip={planFromConversation}
      onNewChat={() => openConversation(true)}
      onClose={closeConversation}
    />
  );
  const isLive = Boolean(trip?.places.some((place) => place.source === "qloo"));
  const feedback = trip ? feedbackTasteSignals(trip) : { likedIds: [], excludedIds: [] };
  const profileSeeds: TasteSeed[] = [
    ...(trip?.brief.tasteProfile?.seeds ?? brief.tasteProfile?.seeds ?? []),
    ...feedback.likedIds.map((id) => ({
      id,
      name: trip?.places.find((place) => place.id === id)?.name ?? "Liked place",
      type: "urn:entity:place",
    })),
  ]
    .filter((seed, index, all) => all.findIndex((other) => other.id === seed.id) === index)
    .slice(0, 20);
  function updateBrief<K extends keyof TripBrief>(key: K, value: TripBrief[K]) {
    setBrief((current) => ({
      ...current,
      [key]: value,
      ...(key === "origin" ? { originDestination: undefined } : {}),
    }));
    if (key === "days" || key === "destinationId") setEntryRoute(undefined);
  }
  function reviewEntryTaste(profile: TasteProfile) {
    if (!identity.ready || !hydrated || trip) return;
    try {
      const reviewed = entryTripReview(brief, profile, entryRoute);
      setEntryPlanning({
        ...reviewed,
        id: crypto.randomUUID(),
        scope: libraryKey,
        tripId: null,
        version: null,
      });
      setBrief(reviewed.brief);
      setTasteOpen(false);
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : "Review your trip details first.");
    }
  }
  function start(mode: "demo" | "empty" = "demo") {
    if (!create(entryRoute, mode)) return;
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
    setView("journey");
    setDayFocused(false);
    setSelectedStopId(null);
    setDayId("day-1");
  }
  const selectStop = useCallback(
    (id: string) => {
      const stop = trip?.stops.find((item) => item.id === id);
      if (!stop) return;
      selectionTrigger.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setDayId(stop.dayId);
      setSelectedStopId(id);
    },
    [trip],
  );
  function openSaved(saved: Trip) {
    if (!openTrip(saved)) return;
    setOpenGeneration((generation) => generation + 1);
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
    setSavedOpen(false);
    setEntryRoute(undefined);
    setDayFocused(false);
    setCompanionOpen(false);
    setView("journey");
    setDayId(saved.days[0]?.id ?? "day-1");
    setSelectedStopId(null);
  }
  function beginNewTrip() {
    if (!reset()) return;
    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
    setEntryRoute(undefined);
    setSelectedStopId(null);
    setDayFocused(false);
    setCompanionOpen(false);
    setView("journey");
    setDayId("day-1");
  }
  function closeDetail() {
    const closingStopId = selectedStopId;
    setSelectedStopId(null);
    requestAnimationFrame(() => {
      const canFocus = (element: HTMLElement) =>
        element.isConnected &&
        element.getClientRects().length > 0 &&
        !element.matches(":disabled") &&
        !element.closest("[inert], [aria-hidden=true]");
      const currentVisit = Array.from(
        document.querySelectorAll<HTMLElement>("[data-stop-id]"),
      ).find((element) => element.dataset.stopId === closingStopId && canFocus(element));
      if (currentVisit) currentVisit.focus();
      else if (selectionTrigger.current && canFocus(selectionTrigger.current))
        selectionTrigger.current.focus();
      else document.getElementById("main-content")?.focus();
    });
  }
  return (
    <main className={`tastip-app ${trip ? "is-planning" : "is-exploring"}`}>
      <a className="skip-link" href="#main-content">
        Skip to trip planner
      </a>
      <header className="topbar planner-topbar">
        <Link href="/" aria-label="Tastip home">
          <Brand />
        </Link>
        <nav className="planner-workspace-nav" aria-label="Main navigation">
          <button
            ref={headerChatTrigger}
            type="button"
            className="planner-workspace-link planner-chat-link"
            aria-label="Chat"
            aria-expanded={conversationOpen}
            aria-controls="planner-chat"
            disabled={!conversations.ready || !preferences.ready}
            onClick={() => (conversationOpen ? closeConversation() : openConversation())}
          >
            <MessageCircle size={17} aria-hidden="true" />
            <span>Chat</span>
          </button>
          <Link href="/explore" className="planner-workspace-link">
            <Compass size={17} aria-hidden="true" />
            <span>Explore</span>
          </Link>
          <Link href="/saved" className="planner-workspace-link">
            <Bookmark size={17} aria-hidden="true" />
            <span>Saved</span>
          </Link>
          <Link href="/discover" className="planner-workspace-link">
            <Sparkles size={17} aria-hidden="true" />
            <span>For you</span>
          </Link>
        </nav>
        <div className="planner-header-actions">
          <span className="nav-context">
            {trip ? `${destination.name}, your way` : "For the way you like to travel"}
          </span>
          <span
            className="sample-badge"
            title={
              trip &&
              trip.places.some((place) => place.source === "demo") &&
              trip.places.some((place) => place.source !== "demo")
                ? "Includes fictional sample venues alongside traveler or provider places."
                : undefined
            }
          >
            <span />
            {trip ? tripSourceLabel(trip) : "Sample mode"}
          </span>
          {!trip && (
            <button
              type="button"
              className="button button-quiet"
              disabled={!hydrated}
              onClick={() => setSavedOpen(!savedOpen)}
            >
              <FolderOpen size={16} />
              <span>Saved trips</span>
            </button>
          )}
          {trip && (
            <button
              type="button"
              className="button button-quiet"
              onClick={() => {
                beginNewTrip();
              }}
            >
              <ArrowLeft size={15} />
              New trip
            </button>
          )}
          <button
            type="button"
            className="button button-quiet account-trigger"
            aria-label={
              identity.account ? `Account ${identity.account.username}` : "Sign in to Tastip"
            }
            disabled={!identity.ready}
            onClick={() => setAccountOpen(true)}
          >
            <UserRound size={17} />
            <span>{identity.account?.username ?? "Sign in"}</span>
          </button>
        </div>
      </header>
      {identity.error && (
        <div className="account-session-notice" role="alert">
          <p>{identity.error}</p>
          <button
            type="button"
            className="button button-secondary"
            onClick={() => void identity.refresh()}
          >
            Retry sign-in check
          </button>
        </div>
      )}
      {notice && (
        <div className="planner-notice" role="status">
          <Info size={16} aria-hidden="true" />
          <span className="planner-notice-copy">{notice}</span>
          <button
            type="button"
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {!hydrated ? (
        <div className="app-loading" role="status">
          <span className="brand-mark">
            <Compass size={24} />
          </span>
          Opening your travel space…
        </div>
      ) : !trip ? (
        <>
          <div
            className={`entry-layout ${chatOpen ? "entry-chat-open" : ""}`}
            id="main-content"
            tabIndex={-1}
          >
            <div className="entry-chat" id="planner-chat" hidden={!chatOpen}>
              {conversationPanel}
            </div>
            <section
              className="entry-content entry-content-compact"
              aria-labelledby="entry-title"
              hidden={chatOpen}
            >
              <p className="eyebrow">
                <span className="eyebrow-line" />
                THE WORLD, THROUGH YOUR TASTE
              </p>
              <h1 id="entry-title">
                A trip that
                <br /> feels like <em>you.</em>
              </h1>
              <p className="entry-description">
                The places you’ll love. The little detours. A journey built around what moves you.
              </p>
              <details className="entry-route-option">
                <summary>
                  <span>Describe a route</span>
                  <span className="entry-route-optional">Optional</span>
                  <ChevronDown size={15} aria-hidden="true" />
                </summary>
                <TripPrompt
                  brief={brief}
                  onReview={(patch, route) => {
                    setBrief((current) => ({ ...current, ...patch }));
                    setEntryRoute(route);
                    setNotice("Route confirmed. Your globe is focused; choose your taste next.");
                  }}
                />
              </details>
              {entryRoute && (
                <p className="confirmed-route-note">
                  Route ready ·{" "}
                  {entryRoute.stays
                    .map((stay) => stay.destination?.name ?? stay.destinationId)
                    .join(" → ")}{" "}
                  · {entryRoute.startDate} · {brief.days} days
                </p>
              )}
              {savedOpen && (
                <>
                  <RemoteTrips
                    key={`remote:${identity.account?.id ?? "guest"}`}
                    trip={null}
                    account={identity.account}
                    onSignIn={() => setAccountOpen(true)}
                    onOpen={openSaved}
                  />
                  <TripLibrary
                    key={libraryKey}
                    storageKey={libraryKey}
                    trip={null}
                    onOpen={openSaved}
                  />
                </>
              )}
              <form
                className="trip-brief"
                onSubmit={(event) => {
                  event.preventDefault();
                  openTaste();
                }}
              >
                <label className="destination-field">
                  <span>
                    <MapPin size={17} aria-hidden="true" />
                    Where are we going?
                  </span>
                  <span className="select-wrap">
                    <select
                      aria-label="Destination"
                      value={brief.destinationId}
                      onChange={(event) => {
                        updateBrief("destinationId", event.target.value);
                        setEntryRoute(undefined);
                      }}
                    >
                      {[
                        ...DESTINATIONS,
                        ...(brief.destination &&
                        !DESTINATIONS.some((city) => city.id === brief.destinationId)
                          ? [brief.destination]
                          : []),
                      ].map((item) => (
                        <option value={item.id} key={item.id}>
                          {item.name}, {item.country}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={18} />
                  </span>
                </label>
                <DestinationSearch
                  value={destination}
                  onSelect={(city) => {
                    setBrief((current) => ({
                      ...current,
                      destinationId: city.id,
                      destination: city,
                    }));
                    setEntryRoute(undefined);
                  }}
                />
                <div className="brief-details">
                  <label>
                    Days
                    <input
                      aria-label="Number of days"
                      type="number"
                      min={1}
                      max={MAX_TRIP_DAYS}
                      value={brief.days}
                      onChange={(event) => updateBrief("days", Number(event.target.value))}
                      required
                    />
                  </label>
                  <label>
                    Travelers
                    <input
                      aria-label="Number of travelers"
                      type="number"
                      min={1}
                      max={20}
                      value={brief.partySize}
                      onChange={(event) => updateBrief("partySize", Number(event.target.value))}
                      required
                    />
                  </label>
                  <label>
                    Your pace
                    <select
                      aria-label="Travel pace"
                      value={brief.pace}
                      onChange={(event) =>
                        updateBrief("pace", event.target.value as TripBrief["pace"])
                      }
                    >
                      <option value="slow">Unhurried</option>
                      <option value="balanced">A little of both</option>
                      <option value="full">See it all</option>
                    </select>
                  </label>
                </div>
                <fieldset className="taste-field">
                  <legend>What’s your kind of day?</legend>
                  <div className="interest-chips">
                    {INTERESTS.map((interest) => (
                      <button
                        type="button"
                        key={interest}
                        aria-pressed={brief.interests.includes(interest)}
                        className={brief.interests.includes(interest) ? "selected" : ""}
                        onClick={() =>
                          updateBrief(
                            "interests",
                            brief.interests.includes(interest)
                              ? brief.interests.filter((item) => item !== interest)
                              : [...brief.interests, interest],
                          )
                        }
                      >
                        {brief.interests.includes(interest) && <Check size={12} />} {interest}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <button
                  className="button button-primary create-trip"
                  type="submit"
                  disabled={!hydrated || !providerReady}
                >
                  {requiresSignIn ? "Sign in to find your places" : "Find my kind of places"}
                  <ArrowRight size={18} />
                </button>
                {requiresSignIn && (
                  <p className="hosted-signin-hint">
                    Your account keeps recommendations and AI planning private. You can explore a
                    sample below.
                  </p>
                )}
                <button
                  type="button"
                  className="button button-secondary sample-trip-button"
                  disabled={!hydrated}
                  onClick={() => start()}
                >
                  Explore my {destination.name}
                  <span>Sample journey</span>
                </button>
                <button
                  type="button"
                  className="button button-quiet blank-plan-button"
                  disabled={!hydrated}
                  onClick={() => start("empty")}
                >
                  Start a blank plan
                  <ArrowRight size={15} />
                </button>
                <details className="optional-brief">
                  <summary>
                    Origin & activity budget <span>Optional</span>
                  </summary>
                  <div className="field-pair">
                    <label>
                      Traveling from
                      <input
                        type="text"
                        value={brief.origin}
                        maxLength={100}
                        placeholder="Your home city"
                        onChange={(event) => updateBrief("origin", event.target.value)}
                      />
                    </label>
                    <label>
                      Activity budget (EUR)
                      <input
                        type="number"
                        min={0}
                        value={brief.budget ?? ""}
                        placeholder="Not sure yet"
                        onChange={(event) =>
                          updateBrief(
                            "budget",
                            event.target.value === "" ? null : Number(event.target.value),
                          )
                        }
                      />
                    </label>
                  </div>
                  <p>Total for all travelers, whole trip. Excludes travel and lodging.</p>
                </details>
              </form>
              <p className="sample-explanation">
                Try an editable sample journey. Venues are fictional.
                <br />
                Nothing is booked; dates and practical details are unverified.
              </p>
              {!tasteOpen && providerReady && !requiresSignIn && (
                <TasteConnect
                  destinationId={brief.destinationId}
                  destination={destination}
                  configured={qlooConfigured}
                  onReview={reviewEntryTaste}
                  onCreate={(places, warnings, profile) => {
                    if (!createFromPlaces(places, warnings, profile, entryRoute)) return;
                    requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
                    setDayId("day-1");
                    setSelectedStopId(null);
                  }}
                />
              )}
            </section>
            <section className="world-stage" aria-label="Explore destinations">
              <div className="world-stage-heading">
                <span className="tiny-star">✦</span> FIND YOUR CORNER OF THE WORLD
              </div>
              <GoogleGlobe
                key={`${scope}:${mapsConfiguration.enabled ? mapsConfiguration.apiKey : "disabled"}`}
                enabled={mapsConfiguration.enabled}
                apiKey={mapsConfiguration.enabled ? mapsConfiguration.apiKey : undefined}
                destination={destination}
                fallback={
                  <Globe
                    destination={destination}
                    routeDestinations={
                      entryRoute
                        ? [
                            ...(brief.originDestination ? [brief.originDestination] : []),
                            ...entryRoute.stays.flatMap((stay) =>
                              stay.destination ? [stay.destination] : [],
                            ),
                          ]
                        : undefined
                    }
                  />
                }
              />
              <div className="destination-coordinate">
                <span>
                  {Math.abs(destination.lat).toFixed(2)}° {destination.lat < 0 ? "S" : "N"}&nbsp;{" "}
                  {Math.abs(destination.lng).toFixed(2)}° {destination.lng < 0 ? "W" : "E"}
                </span>
                <div>
                  <span className="location-pin">
                    <MapPin size={16} />
                  </span>
                  <div>
                    <strong>{destination.name}</strong>
                    <small>{destination.country}</small>
                  </div>
                  <span className="destination-stamp">LET’S WANDER</span>
                </div>
              </div>
              <div className="globe-help">
                <Globe2 size={14} />
                {entryRoute
                  ? "Your city route, illustrated · Transport not booked"
                  : "Drag to explore · Choose a city to begin"}
              </div>
              <div className="world-stage-corner" aria-hidden="true">
                YOUR NEXT
                <br />
                GOOD STORY.
              </div>
            </section>
          </div>
          <section className="entry-bottom">
            <p>
              <span className="tiny-star">✦</span>Good trips start with a feeling.
            </p>
            <div>
              <span>Not just the sights.</span>
              <span>Find your people, places & pace.</span>
            </div>
            <button
              type="button"
              className="button button-quiet"
              onClick={() => (chatOpen ? closeConversation() : openConversation())}
              aria-expanded={chatOpen}
            >
              <Sparkles size={16} />
              {chatOpen ? "Close companion" : "Talk through an idea"}
              <ArrowRight size={15} />
            </button>
          </section>
        </>
      ) : (
        <>
          <div className="planner-titlebar">
            <div>
              <button
                type="button"
                className="back-button"
                aria-label="Back to destination selection"
                onClick={beginNewTrip}
              >
                <ArrowLeft size={19} />
              </button>
              <TripName
                key={`${trip.id}:${openGeneration}`}
                trip={trip}
                defaultTitle={
                  trip.route && trip.route.stays.length > 1
                    ? "Your journey, city by city."
                    : `${destination.name}, at your own pace.`
                }
                onCommand={command}
              />
            </div>
            <div className="trip-meta">
              <span>
                <Users size={14} />
                {trip.brief.partySize} {trip.brief.partySize === 1 ? "traveler" : "travelers"}
              </span>
              <span>
                {trip.days.length} {trip.days.length === 1 ? "day" : "days"}
                {trip.route
                  ? ` / ${trip.days.length - 1} ${trip.days.length === 2 ? "night" : "nights"}`
                  : ""}
              </span>
              <span>Draft v{trip.version}</span>
              {isLive && (
                <button
                  type="button"
                  className="button button-secondary refine-taste-button"
                  onClick={openTaste}
                >
                  <Sparkles size={15} />
                  Rebuild with taste
                </button>
              )}
              <button
                type="button"
                className="button button-secondary"
                aria-expanded={companionOpen}
                onClick={() => (companionOpen ? closeConversation() : openConversation())}
              >
                <MessageCircle size={16} />
                Companion
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={!canUndo}
                onClick={undoLast}
              >
                <RotateCcw size={15} />
                Undo
              </button>
            </div>
          </div>
          <div
            key={`${trip.id}:${openGeneration}`}
            className={`planning-workspace ${selectedStop ? "with-detail" : ""} ${dayFocused && view === "journey" ? "day-focused" : ""} ${companionOpen ? "companion-open" : ""} ${view === "journey" ? "is-journey" : ""}`}
            id="main-content"
            tabIndex={-1}
          >
            <aside className="workspace-chat" id="planner-chat" hidden={!companionOpen}>
              {conversationPanel}
            </aside>
            <section ref={planBody} className="plan-main" aria-label="Your trip plan">
              <RoutePlan key={`route:${trip.id}`} trip={trip} dayId={dayId} onCommand={command} />
              <details className="planner-qloo-disclosure">
                <summary>
                  Your taste in this trip <Sparkles size={14} aria-hidden="true" />
                </summary>
                <QlooEvidence
                  trip={trip}
                  dayId={dayId}
                  onSelectStop={selectStop}
                  onOpenTaste={openTaste}
                  onOpenIdeas={() => {
                    setSelectedStopId(null);
                    setView("ideas");
                  }}
                />
              </details>
              <nav className="plan-modes" aria-label="Planning views">
                {PLANNING_VIEWS.map(([id, title]) => (
                  <button
                    type="button"
                    key={id}
                    aria-pressed={view === id}
                    onClick={() => {
                      setView(id);
                      setDayFocused(false);
                      setSelectedStopId(null);
                    }}
                  >
                    {title}
                  </button>
                ))}
                <select
                  className="mobile-plan-views"
                  aria-label="More planning views"
                  value={["journey", "list", "map"].includes(view) ? "" : view}
                  onChange={(event) => {
                    setView(event.target.value as PlanningView);
                    setDayFocused(false);
                    setSelectedStopId(null);
                  }}
                >
                  <option value="" disabled>
                    More views
                  </option>
                  {PLANNING_VIEWS.slice(3).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </nav>
              {view !== "journey" &&
                view !== "calendar" &&
                view !== "saved" &&
                view !== "pack" &&
                view !== "details" && (
                  <fieldset className="day-tabs toolbar-day-tabs" aria-label="Trip day">
                    {trip.days.map((day) => (
                      <button
                        type="button"
                        key={day.id}
                        className={day.id === dayId ? "selected" : ""}
                        aria-pressed={day.id === dayId}
                        onClick={() => {
                          setDayId(day.id);
                          setSelectedStopId(null);
                        }}
                      >
                        {day.label}
                      </button>
                    ))}
                  </fieldset>
                )}
              {view !== "details" && <PracticalChecks trip={trip} dayId={dayId} />}
              {view === "journey" && (
                <DayExperience
                  onCommand={command}
                  trip={trip}
                  dayId={dayId}
                  onOpenStays={() => {
                    setSelectedStopId(null);
                    setView("stays");
                  }}
                  onOpenMap={() => {
                    setSelectedStopId(null);
                    setView("map");
                  }}
                  onDayChange={(id) => {
                    setDayId(id);
                    setSelectedStopId(null);
                  }}
                  selectedStopId={selectedStopId}
                  onSelectStop={selectStop}
                  onFocusChange={setDayFocused}
                  focusOnEntry={dayFocused}
                  onFindPlaces={() => recommendationAction.current?.find()}
                  onOpenIdeas={(schedule) => {
                    setIdeaSchedule(schedule ? { ...schedule, dayId, tripId: trip.id } : null);
                    setSelectedStopId(null);
                    setView("ideas");
                    setDayFocused(false);
                  }}
                />
              )}
              {view === "list" && (
                <ItineraryList
                  trip={trip}
                  dayId={dayId}
                  selectedStopId={selectedStopId}
                  onSelect={selectStop}
                />
              )}
              {view === "ideas" && (
                <IdeasPanel
                  key={`${trip.id}:${dayId}`}
                  trip={trip}
                  dayId={dayId}
                  onCommand={command}
                  initialSchedule={
                    ideaSchedule?.dayId === dayId && ideaSchedule.tripId === trip.id
                      ? ideaSchedule
                      : undefined
                  }
                  onOpenDay={() => {
                    setSelectedStopId(null);
                    setDayFocused(true);
                    setView("journey");
                  }}
                  onSelectVisit={(id) => {
                    selectStop(id);
                    setDayFocused(true);
                    setView("journey");
                  }}
                />
              )}
              {view === "calendar" && (
                <TravelCalendar
                  trip={trip}
                  dayId={dayId}
                  onDayChange={(id) => {
                    setDayId(id);
                    setSelectedStopId(null);
                  }}
                  onSelectStop={selectStop}
                  onOpenDay={(id) => {
                    setDayId(id);
                    setSelectedStopId(null);
                    setDayFocused(true);
                    setView("journey");
                  }}
                />
              )}
              {view === "map" && (
                <GeographicPlan
                  trip={trip}
                  dayId={dayId}
                  onSelectStop={selectStop}
                  onOpenDay={() => {
                    setSelectedStopId(null);
                    setDayFocused(true);
                    setView("journey");
                  }}
                />
              )}
              {view === "stays" && (
                <LodgingPanel
                  key={trip.id}
                  trip={trip}
                  dayId={dayId}
                  configured={qlooConfigured}
                  onCommand={command}
                  onTaste={openTaste}
                />
              )}
              {view === "costs" && (
                <CostPlanner key={`costs:${trip.id}`} trip={trip} onCommand={command} />
              )}
              {view === "pack" && <TravelPack trip={trip} />}
              {view === "details" && <TripDetails key={trip.id} trip={trip} onCommand={command} />}
              {view === "saved" && (
                <>
                  <RemoteTrips
                    key={`remote:${identity.account?.id ?? "guest"}:${trip.id}`}
                    trip={trip}
                    account={identity.account}
                    onSignIn={() => setAccountOpen(true)}
                    onOpen={openSaved}
                  />
                  <TripLibrary
                    key={libraryKey}
                    storageKey={libraryKey}
                    trip={trip}
                    onOpen={openSaved}
                  />
                </>
              )}
              {view !== "pack" &&
                view !== "saved" &&
                view !== "stays" &&
                view !== "costs" &&
                view !== "details" && (
                  <CityRecommendations
                    actionRef={recommendationAction}
                    trip={trip}
                    dayId={dayId}
                    configured={qlooConfigured}
                    onCommand={command}
                    onTaste={openTaste}
                  />
                )}
              <div className="plan-summary">
                <span>
                  <span className="tiny-star">✦</span>
                  {trip.stops.filter((stop) => stop.dayId === dayId).length} visits ·{" "}
                  {trip.brief.pace === "slow"
                    ? "Unhurried"
                    : trip.brief.pace === "full"
                      ? "Full days"
                      : "A little of both"}
                </span>
                <span>
                  {tripSourceLabel(trip) === "Qloo draft"
                    ? "Qloo-ranked draft"
                    : tripSourceLabel(trip)}{" "}
                  · Practical details unverified
                </span>
              </div>
            </section>
            {selectedStop &&
              (view === "journey" ? (
                <VisitDialog
                  name={
                    trip.places.find((place) => place.id === selectedStop.placeId)?.name ?? "Place"
                  }
                  onClose={closeDetail}
                >
                  <StopDetail
                    key={`${trip.id}:${selectedStop.id}`}
                    trip={trip}
                    stop={selectedStop}
                    onClose={closeDetail}
                    onCommand={command}
                    onSelectVisit={selectStop}
                  />
                </VisitDialog>
              ) : (
                <StopDetail
                  key={`${trip.id}:${selectedStop.id}`}
                  trip={trip}
                  stop={selectedStop}
                  onClose={closeDetail}
                  onCommand={command}
                  onSelectVisit={selectStop}
                />
              ))}
          </div>
        </>
      )}
      {chatPlanning && (
        <ConversationPlanning
          key={chatPlanning.id}
          request={chatPlanning}
          planner={planner}
          conversations={conversations}
          configured={qlooConfigured}
          firstName={profile?.firstName ?? identity.account?.username}
          theme="planner"
          onClose={() => setChatPlanning(null)}
          onNotice={setNotice}
          onAccepted={(prepared, chatId) => {
            setChatPlanning(null);
            setPlannerChatId(chatId ?? null);
            setOpenGeneration((value) => value + 1);
            setView("journey");
            setDayId(prepared.days[0]?.id ?? "day-1");
            setDayFocused(false);
            setSelectedStopId(null);
            setCompanionOpen(Boolean(chatId));
            setChatOpen(false);
            requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
          }}
        />
      )}
      {hydrated && accountOpen && (
        <AccountDialog
          currentProfile={trip?.brief.tasteProfile}
          account={identity.account}
          hasDraft={Boolean(trip)}
          onClose={() => setAccountOpen(false)}
          onAuthenticated={(account, keepDraft) => {
            setHeldPendingChatId(activeChat?.id ?? null);
            if (keepDraft && trip) {
              try {
                const key = `tastip.trip.v1:${account.id}`;
                if (!localStorage.getItem(key)) {
                  localStorage.setItem(key, JSON.stringify(trip));
                  localStorage.removeItem("tastip.trip.v1");
                }
              } catch {
                setNotice(
                  "Signed in. Your current draft could not move into the account cache; keep a backup.",
                );
              }
            }
            setSelectedStopId(null);
            setTasteOpen(false);
            setChatOpen(false);
            setEntryRoute(undefined);
            setView("journey");
            identity.setAccount(account);
          }}
          onSignedOut={() => {
            try {
              if (identity.account) {
                localStorage.removeItem(`tastip.server-bases.${identity.account.id}`);
              }
            } catch {
              /* The server session is already revoked; identity still must clear. */
            }
            setSelectedStopId(null);
            setTasteOpen(false);
            setChatOpen(false);
            setEntryRoute(undefined);
            setView("journey");
            identity.setAccount(null);
          }}
        />
      )}
      {identity.ready && entryPlanning?.scope === libraryKey && (
        <div className="planner-conversation-planning">
          <TripGenerationReview
            key={entryPlanning.id}
            brief={entryPlanning.brief}
            route={entryPlanning.route}
            configured={qlooConfigured}
            currentTrip={trip}
            previous={entryPlanning}
            onAccept={(prepared) => {
              if (!identity.ready || entryPlanning.scope !== libraryKey) return false;
              if (!planner.acceptPreparedTrip(prepared, entryPlanning)) return false;
              setEntryPlanning(null);
              setDayId(prepared.days[0]?.id ?? "day-1");
              setSelectedStopId(null);
              setDayFocused(false);
              setView("journey");
              requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
              return true;
            }}
            onBack={() => setEntryPlanning(null)}
            onClose={() => setEntryPlanning(null)}
          />
        </div>
      )}
      {hydrated && tasteOpen && (
        <TasteDialog
          account={identity.account}
          destinationId={trip?.brief.destinationId ?? brief.destinationId}
          destinationName={destination.name}
          destination={destination}
          configured={qlooConfigured}
          initialSeeds={profileSeeds}
          initialProfile={trip?.brief.tasteProfile ?? brief.tasteProfile}
          excludedIds={feedback.excludedIds}
          replacingDraft={Boolean(trip)}
          onReview={!trip ? reviewEntryTaste : undefined}
          onClose={() => setTasteOpen(false)}
          onCreate={(places, warnings, profile) => {
            if (!createFromPlaces(places, warnings, profile, entryRoute)) return;
            requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "instant" }));
            setDayId("day-1");
            setSelectedStopId(null);
            setTasteOpen(false);
          }}
        />
      )}
    </main>
  );
}
