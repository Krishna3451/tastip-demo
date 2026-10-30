"use client";

import {
  briefDestination,
  DESTINATIONS,
  type Destination,
  destinationForDay,
  feedbackTasteSignals,
  getTripDestination,
  type Place,
  parseStoredTrip,
  type Trip,
  type TripBrief,
  type TripRoute,
} from "@tastip/domain";
import {
  ArrowLeft,
  Bell,
  BriefcaseBusiness,
  Check,
  ChevronRight,
  MessageCircle,
  Plus,
  Share2,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ProviderAccess, useProviderFetch } from "@/lib/provider-fetch";
import { AccountDialog } from "../planner/components/account-dialog";
import { ChatPanel } from "../planner/components/chat-panel";
import { CityRecommendations } from "../planner/components/city-recommendations";
import { CostPlanner } from "../planner/components/cost-planner";
import { LodgingPanel } from "../planner/components/lodging-panel";
import { RemoteTrips } from "../planner/components/remote-trips";
import { RoutePlan } from "../planner/components/route-plan";
import { TasteDialog } from "../planner/components/taste-dialog";
import { TravelPack } from "../planner/components/travel-pack";
import { TripDetails } from "../planner/components/trip-details";
import { TripLibrary } from "../planner/components/trip-library";
import {
  type AccountRequest,
  AccountResponseError,
  announceAccountChange,
  beginAccountMutation,
  finishAccountMutation,
  requestAccount,
} from "../planner/lib/account-request";
import type { Conversation } from "../planner/lib/conversations";
import { parseSavedPlaceRecord } from "../planner/lib/saved-places";
import { tripTitle } from "../planner/lib/travel-pack";
import { useAccount } from "../planner/use-account";
import { usePlanner } from "../planner/use-planner";
import { AddPlace } from "./add-place";
import { CalendarWorkspace, TripCalendar } from "./calendar";
import { ChatBackup } from "./chat-backup";
import { Inspiration, TripsIndex } from "./collections";
import { EntryComposer } from "./composer";
import { ConversationPlanning, type ConversationPlanningRequest } from "./conversation-planning";
import { DiscoveryFrame } from "./discovery-frame";
import { ExploreWorkspace } from "./explore";
import { HomeFeed } from "./home";
import { Itinerary, TextDialog } from "./itinerary";
import { AgentManager, CollectionManager, CreatorHub } from "./managers";
import { MediaPanel, ReceiptsWorkspace } from "./media";
import { retainMediaForAccount } from "./media-store";
import { Navigation } from "./navigation";
import { Onboarding, parseTravelProfile, type TravelProfile } from "./onboarding";
import { AssistantMark, EmptyState, Modal } from "./primitives";
import { SavedSync } from "./saved-sync";
import { ProfileWorkspace, SettingsWorkspace } from "./settings";
import { TripTravelers } from "./travelers";
import { TripBriefEditor } from "./trip-brief";
import { TripDialog } from "./trip-dialog";
import { TripGenerationReview } from "./trip-generation-review";
import { TripOverview } from "./trip-overview";
import { useConversations } from "./use-conversations";
import { useSavedWorkspace } from "./use-saved-workspace";
import { useSettings } from "./use-settings";
import { Venue } from "./venue";

type Panel =
  | "media"
  | "chats"
  | "itinerary"
  | "ideas"
  | "calendar"
  | "bookings"
  | "preferences"
  | "share"
  | "account-trips"
  | "costs"
  | "pack"
  | "route"
  | "find"
  | null;
type PlanningSource = {
  scope: string;
  tripId: string | null;
  version: number | null;
  chatId?: string;
};

export function ReferenceApp() {
  return (
    <Suspense
      fallback={
        <main className="mt-app">
          <div className="mt-loading" role="status">
            Opening your travel space…
          </div>
        </main>
      }
    >
      <ReferenceSession />
    </Suspense>
  );
}

function ReferenceSession() {
  const identity = useAccount();
  return (
    <ProviderAccess accountId={identity.account?.id ?? null} ready={identity.ready}>
      <ReferenceWorkspace identity={identity} />
    </ProviderAccess>
  );
}

function ReferenceWorkspace({ identity }: { identity: ReturnType<typeof useAccount> }) {
  const searchParams = useSearchParams();
  const handledTripIntent = useRef("");
  const router = useRouter();
  const path = usePathname();
  const returnToPlanner = searchParams.get("return") === "planner";
  const returnDay = searchParams.get("day") ?? "";
  const providerFetch = useProviderFetch();
  const planner = usePlanner(identity.account?.id ?? null, identity.ready);
  const { trip, brief, setBrief, notice, setNotice } = planner;
  const [accountOpen, setAccountOpen] = useState(false);
  const [heldPendingChatId, setHeldPendingChatId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [tasteOpen, setTasteOpen] = useState(false);
  const [panel, setPanel] = useState<Panel>(null);
  const [calendarVisitId, setCalendarVisitId] = useState<string | undefined>();
  useEffect(() => {
    if (panel !== "itinerary") setCalendarVisitId(undefined);
  }, [panel]);
  const [planningDayId, setPlanningDayId] = useState<string | null>(null);
  const planningDay = trip?.days.find((day) => day.id === planningDayId) ?? trip?.days[0];
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [schedulingPlace, setSchedulingPlace] = useState<Place | null>(null);
  const [titleEdit, setTitleEdit] = useState(false);
  const [provider, setProvider] = useState({
    qloo: false,
    openai: false,
    requiresSignIn: false,
    checkedScope: null as string | null,
  });
  const [tripCache, setTripCache] = useState<{ scope: string; items: Trip[] }>({
    scope: "",
    items: [],
  });
  const trips = planner.hydrated && tripCache.scope === planner.libraryKey ? tripCache.items : [];
  const [profile, setProfile] = useState<TravelProfile | null>(null);
  const newChatRouteStarted = useRef(false);
  const openedChat = useRef("");
  const openedTripPath = useRef("");
  const [pendingCreate, setPendingCreate] = useState(false);
  const [createPrompt, setCreatePrompt] = useState("");
  const [chatPlanning, setChatPlanning] = useState<ConversationPlanningRequest | null>(null);
  const [planning, setPlanning] = useState<{
    brief: TripBrief;
    route: TripRoute;
    prompt: string;
    source: PlanningSource;
  } | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);
  const recommendationAction = useRef<{ find: () => void }>(null);
  const scope = identity.account?.id ?? "guest";
  const accountHandoffNotice = useRef<{ owner: string; message: string } | null>(null);
  useEffect(() => {
    const pending = accountHandoffNotice.current;
    if (!pending) return;
    if (scope !== pending.owner) {
      if (identity.ready && scope !== "guest") accountHandoffNotice.current = null;
      return;
    }
    if (!planner.hydrated) return;
    accountHandoffNotice.current = null;
    setNotice(pending.message);
  }, [scope, identity.ready, planner.hydrated, setNotice]);
  const logoutRequest = useRef<{ request: AccountRequest; owner: string } | null>(null);
  const logoutScope = useRef(scope);
  logoutScope.current = scope;
  useEffect(
    () => () => {
      const pending = logoutRequest.current;
      if (pending && pending.owner === scope) {
        logoutRequest.current = null;
        pending.request.cancel();
        finishAccountMutation(pending.request);
        announceAccountChange(true);
      }
    },
    [scope],
  );
  const conversations = useConversations(scope, identity.ready);
  const preferences = useSettings(scope, identity.ready);
  const [renamingChat, setRenamingChat] = useState<Conversation | null>(null);
  const activeChat = path.startsWith("/chat/")
    ? conversations.items.find((item) => item.id === path.split("/")[2])
    : undefined;
  const chatTrip = activeChat?.tripId
    ? trip?.id === activeChat.tripId
      ? trip
      : (trips.find((item) => item.id === activeChat.tripId) ?? null)
    : null;
  useEffect(() => {
    if (conversations.error) setNotice(conversations.error);
  }, [conversations.error, setNotice]);
  const savedWorkspace = useSavedWorkspace(identity.account?.id ?? null, identity.ready);
  const saved = savedWorkspace.workspace.places.map(({ place }) => place);
  const savedLocations = useRef<Record<string, Destination>>({});
  const onTripPage = path.startsWith("/trip/");
  const onChatPage = path === "/chat" || path.startsWith("/chat/");
  const warmDiscovery = ["/explore", "/saved", "/discover"].includes(path) || onChatPage;
  const returnTrip = chatTrip ?? trip;
  const plannerDay = returnTrip?.days.find((day) => day.id === returnDay) ?? returnTrip?.days[0];
  const plannerReturnHref = plannerDay ? `/?${new URLSearchParams({ day: plannerDay.id })}` : "/";
  useEffect(() => {
    if (!onTripPage || searchParams.get("view") !== "itinerary") {
      handledTripIntent.current = "";
      return;
    }
    if (!planner.hydrated || !trip || path !== `/trip/${trip.id}`) return;
    const key = `${scope}:${path}?${searchParams.toString()}`;
    if (handledTripIntent.current === key) return;
    handledTripIntent.current = key;
    const visit = trip.stops.find((stop) => stop.id === searchParams.get("visit"));
    const day =
      trip.days.find((day) => day.id === (visit?.dayId ?? searchParams.get("day"))) ??
      trip.days[0]!;
    setPlanningDayId(day.id);
    setCalendarVisitId(visit?.id);
    setPanel("itinerary");
  }, [onTripPage, searchParams, planner.hydrated, trip, path, scope]);
  const providerReady = identity.ready && provider.checkedScope === scope;
  const chatAvailable =
    preferences.ready && !preferences.error && providerReady && !provider.requiresSignIn;
  const chatUnavailableReason = preferences.error
    ? "Chat and voice are paused because saved preferences could not be read. Their stored copy has been kept."
    : !preferences.ready
      ? "Chat and voice are paused while your preferences are checked."
      : provider.requiresSignIn
        ? "Sign in to chat, plan with Tastip and find your places."
        : "Chat and voice are paused while provider access is checked. Reload to retry if this continues.";
  const chatSignIn =
    provider.requiresSignIn && preferences.ready && !preferences.error
      ? () => setAccountOpen(true)
      : undefined;
  function openTaste() {
    if (provider.requiresSignIn) setAccountOpen(true);
    else if (providerReady) setTasteOpen(true);
  }
  const city = briefDestination(trip?.brief ?? brief) ?? DESTINATIONS[0]!;
  useEffect(() => {
    setProvider({ qloo: false, openai: false, requiresSignIn: false, checkedScope: null });
    if (!identity.ready) return;
    const controller = new AbortController();
    providerFetch("/api/health", { signal: controller.signal })
      .then((response) => {
        if (!response.ok) throw new Error("Provider access could not be checked.");
        return response.json();
      })
      .then((body) => {
        if (!controller.signal.aborted)
          setProvider({
            qloo: Boolean(body.providers?.qloo),
            openai: Boolean(body.providers?.openai),
            requiresSignIn: body.requiresSignIn === true,
            checkedScope: scope,
          });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [identity.ready, providerFetch, scope]);
  useEffect(() => {
    if (!planner.hydrated) return;
    try {
      const value: unknown = JSON.parse(localStorage.getItem(planner.libraryKey) ?? "[]");
      const restored = Array.isArray(value)
        ? value.map(parseStoredTrip).filter((item): item is Trip => Boolean(item))
        : [];
      setTripCache({
        scope: planner.libraryKey,
        items: trip ? [trip, ...restored.filter((item) => item.id !== trip.id)] : restored,
      });
    } catch {
      setTripCache({ scope: planner.libraryKey, items: trip ? [trip] : [] });
    }
  }, [planner.hydrated, planner.libraryKey, trip]);
  useEffect(() => {
    if (!identity.ready) return;
    setProfile(null);
    savedLocations.current = {};
    try {
      const storedProfile = localStorage.getItem(`tastip.reference.profile:${scope}`);
      if (storedProfile) {
        const restored = parseTravelProfile(JSON.parse(storedProfile));
        if (restored) setProfile(restored);
      }
    } catch {
      setNotice(
        "This browser could not restore travel preferences. The stored copy has been kept.",
      );
    }
  }, [identity.ready, scope, setNotice]);
  useEffect(() => {
    if (pendingCreate && trip) {
      setPendingCreate(false);
      router.push(returnToPlanner ? "/" : `/trip/${trip.id}`);
    }
  }, [pendingCreate, trip, router, returnToPlanner]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Identity changes close transient controls from the previous private workspace.
  useEffect(() => {
    setPanel(null);
    setSelectedPlace(null);
    setSchedulingPlace(null);
    setTitleEdit(false);
    setCreating(false);
    setTasteOpen(false);
    setVoiceOpen(false);
    setRenamingChat(null);
    setCalendarVisitId(undefined);
    setPlanningDayId(null);
    setAccountOpen(false);
    setPlanning(null);
    setChatPlanning(null);
  }, [scope, identity.ready]);
  const savedIds = saved.map((place) => place.id);
  const discoveryCollection = savedWorkspace.workspace.collections.find(
    (collection) => collection.id === searchParams.get("collection"),
  );
  const collectionDiscovery = path === "/explore" && searchParams.has("collection");
  function addToDiscoveryCollection(place: Place, destination: Destination) {
    const record = parseSavedPlaceRecord({ place, destination });
    if (!record || !discoveryCollection) {
      setNotice("Open this collection from Saved before adding places.");
      return;
    }
    const places = savedIds.includes(place.id)
      ? savedWorkspace.workspace.places
      : [...savedWorkspace.workspace.places, record];
    if (
      savedWorkspace.update({
        places,
        collections: savedWorkspace.workspace.collections.map((collection) =>
          collection.id === discoveryCollection.id
            ? { ...collection, placeIds: [...new Set([...collection.placeIds, place.id])] }
            : collection,
        ),
      })
    )
      setNotice(`Added to ${discoveryCollection.name}.`);
    else
      setNotice(
        savedWorkspace.error || "Wait for Saved to finish syncing before adding another place.",
      );
  }
  function savePlace(place: Place, discoveryDestination?: Destination) {
    const destination =
      discoveryDestination ??
      savedWorkspace.workspace.places.find((item) => item.place.id === place.id)?.destination ??
      savedLocations.current[place.id] ??
      (trip
        ? getTripDestination(trip, place.destinationId ?? trip.brief.destinationId)
        : undefined);
    const record = parseSavedPlaceRecord({ place, ...(destination ? { destination } : {}) });
    if (!record) {
      setNotice(
        "This place could not be saved with its destination. Your existing saves are unchanged.",
      );
      return;
    }
    const next = savedIds.includes(place.id)
      ? savedWorkspace.workspace.places.filter((item) => item.place.id !== place.id)
      : [...savedWorkspace.workspace.places, record];
    if (savedWorkspace.update({ ...savedWorkspace.workspace, places: next }))
      setNotice(
        savedIds.includes(place.id)
          ? "Removed from Saved."
          : savedWorkspace.account
            ? "Saved on this device; syncing to your account."
            : "Saved for later.",
      );
    else
      setNotice(
        savedWorkspace.error || "Wait for Saved to finish loading or syncing before changing it.",
      );
  }
  function addPlace(place: Place) {
    if (!trip) {
      setCreating(true);
      setNotice("Create a trip first, then add this place to your itinerary.");
      return;
    }
    setSchedulingPlace(place);
  }

  function openTrip(next: Trip) {
    if (planner.openTrip(next)) {
      router.push(`/trip/${next.id}`);
      setPanel(null);
    }
  }
  function openCalendar(next: Trip, dayId?: string, stopId?: string) {
    if (next.id !== trip?.id && !planner.openTrip(next)) return;
    // Across pages, let the destination's validated URL intent open the visit.
    // Showing a dialog before navigation commits can reload the previous page instead.
    if (path === `/trip/${next.id}`) {
      setPlanningDayId(dayId ?? next.days[0]!.id);
      setCalendarVisitId(stopId);
      setPanel("itinerary");
    }
    const query = new URLSearchParams({ view: "itinerary", day: dayId ?? next.days[0]!.id });
    if (stopId) query.set("visit", stopId);
    router.push(`/trip/${next.id}?${query}`);
  }
  function create(next: TripBrief, route?: TripRoute, prompt?: string) {
    if (planner.createFromPlaces([], [], next.tasteProfile, route, next)) {
      setCreating(false);
      setCreatePrompt(prompt ?? "");
      setPendingCreate(true);
    }
  }
  function beginPlanning(next: TripBrief, route?: TripRoute, prompt = "") {
    if (!route) return;
    setPlanning({
      brief: next,
      route,
      prompt,
      source: {
        scope: planner.libraryKey,
        tripId: trip?.id ?? null,
        version: trip?.version ?? null,
      },
    });
  }
  function planFromChat(request: string, chatId: string) {
    setChatPlanning({
      id: crypto.randomUUID(),
      scope: planner.libraryKey,
      tripId: trip?.id ?? null,
      version: trip?.version ?? null,
      chatId,
      prompt: request.slice(0, 2000),
    });
  }
  function acceptPlannedTrip(prepared: Trip) {
    if (!planning || planning.source.scope !== planner.libraryKey || !conversations.writable)
      return false;
    if (!planner.acceptPreparedTrip(prepared, planning.source)) return false;
    let chatId = planning.source.chatId;
    if (chatId) {
      if (!conversations.associateTrip(chatId, prepared.id)) chatId = undefined;
    } else {
      chatId = conversations.create(
        prepared.id,
        planning.prompt || `Help me with my ${prepared.brief.destination?.name ?? "new"} trip.`,
      )?.id;
    }
    setPlanning(null);
    setChatPlanning(null);
    setCreating(false);
    router.push(returnToPlanner ? "/" : chatId ? `/chat/${chatId}` : `/trip/${prepared.id}`);
    if (!chatId)
      setNotice(
        "Your trip is saved. Its chat could not be linked; you can open the trip from Trips.",
      );
    return true;
  }
  function chooseCity(destination: Destination) {
    setBrief((current) => ({ ...current, destinationId: destination.id, destination }));
    setCreatePrompt(`A trip to ${destination.name}`);
    setCreating(true);
  }
  const newChat = useCallback(
    (text = "", associatedTrip?: Trip | null) => {
      const next = conversations.create(associatedTrip?.id, text);
      if (!next) return;
      const query = returnToPlanner
        ? `?${new URLSearchParams({ return: "planner", ...(returnDay ? { day: returnDay } : {}) })}`
        : "";
      router.push(`/chat/${next.id}${query}`);
    },
    [conversations.create, router, returnToPlanner, returnDay],
  );
  function startChat(text: string) {
    newChat(text, onTripPage ? trip : null);
  }
  useEffect(() => {
    if (path !== "/chat" && path !== "/chat/new") {
      newChatRouteStarted.current = false;
      return;
    }
    if (
      conversations.ready &&
      (!returnToPlanner || planner.hydrated) &&
      !newChatRouteStarted.current
    ) {
      newChatRouteStarted.current = true;
      newChat("", returnToPlanner && trip?.id === searchParams.get("trip") ? trip : null);
    }
  }, [path, conversations.ready, newChat, returnToPlanner, planner.hydrated, searchParams, trip]);
  useEffect(() => {
    if (!onChatPage) {
      openedChat.current = "";
      return;
    }
    const key = `${scope}:${activeChat?.id ?? ""}`;
    if (chatTrip && openedChat.current !== key) {
      openedChat.current = key;
      if (chatTrip.id !== trip?.id) planner.openTrip(chatTrip);
    }
  }, [onChatPage, scope, activeChat?.id, chatTrip, planner.openTrip, trip?.id]);
  async function logOut() {
    if (logoutRequest.current) return;
    const request = beginAccountMutation();
    if (!request) {
      setNotice("Another account request is running. Try again shortly.");
      return;
    }
    const owner = scope;
    const pending = { request, owner };
    logoutRequest.current = pending;
    const current = () =>
      logoutRequest.current === pending && logoutScope.current === owner && !request.signal.aborted;
    try {
      await requestAccount(request, "logout");
      if (!current()) {
        if (logoutRequest.current === pending) {
          logoutRequest.current = null;
          request.cancel();
          announceAccountChange(true);
        }
        return;
      }
      logoutRequest.current = null;
      finishAccountMutation(request);
      signOut();
    } catch (cause) {
      if (logoutRequest.current !== pending || logoutScope.current !== owner) return;
      logoutRequest.current = null;
      request.cancel();
      setNotice(cause instanceof Error ? cause.message : "Could not log out. Try again.");
      if (!(cause instanceof AccountResponseError))
        announceAccountChange(
          true,
          cause instanceof Error ? cause.message : "Could not log out. Retry the sign-in check.",
        );
    } finally {
      finishAccountMutation(request);
    }
  }
  function finishProfile(next: TravelProfile) {
    try {
      localStorage.setItem(`tastip.reference.profile:${scope}`, JSON.stringify(next));
      setProfile(next);
      setNotice("Your travel preferences are saved on this device.");
      router.push("/home");
    } catch {
      setNotice("This browser could not save your preferences. Keep this page open and try again.");
    }
  }
  function signOut() {
    if (identity.account) {
      for (const key of [`tastip.server-bases.${identity.account.id}`]) {
        try {
          localStorage.removeItem(key);
        } catch {
          /* The server session was already revoked. */
        }
      }
    }
    identity.setAccount(null);
    setSchedulingPlace(null);
    setProfile(null);
    setSelectedPlace(null);
    setTasteOpen(false);
    setVoiceOpen(false);
    setPanel(null);
    router.push("/home");
  }
  const tripPathId = onTripPage || onChatPage ? path.split("/")[2] : null;
  useEffect(() => {
    if (!onTripPage) {
      openedTripPath.current = "";
      return;
    }
    const key = `${scope}:${tripPathId}`;
    if (!planner.hydrated || openedTripPath.current === key) return;
    if (tripPathId === trip?.id) {
      openedTripPath.current = key;
      return;
    }
    const cached = trips.find((item) => item.id === tripPathId);
    if (cached) {
      openedTripPath.current = key;
      planner.openTrip(cached);
    }
  }, [onTripPage, scope, planner.hydrated, planner.openTrip, tripPathId, trips, trip?.id]);
  const mismatchedTrip = Boolean(onTripPage && tripPathId !== trip?.id);
  const commonPlaces = { savedIds, onSave: savePlace, onPlace: setSelectedPlace, onAdd: addPlace };
  return (
    <main
      className={`mt-app ${warmDiscovery ? "tastip-app tastip-discovery" : ""} ${onChatPage ? "tastip-conversation" : ""}`}
    >
      <a className="skip-link" href="#mt-main">
        Skip to content
      </a>
      {path === "/setup" ? (
        <Onboarding initial={profile} onComplete={finishProfile} />
      ) : (
        <>
          {warmDiscovery ? (
            <DiscoveryFrame
              path={path}
              username={identity.account?.username}
              chats={conversations.items}
              plannerContext={
                returnToPlanner && chatTrip && plannerDay
                  ? { tripId: chatTrip.id, dayId: plannerDay.id }
                  : undefined
              }
              onNewChat={() => newChat()}
              onRenameChat={setRenamingChat}
              onArchiveChat={conversations.archive}
              onSignOut={() => void logOut()}
              onAccount={() => setAccountOpen(true)}
              onCreate={() => setCreating(true)}
            />
          ) : (
            <Navigation
              path={path}
              username={identity.account?.username}
              chats={conversations.items}
              onNewChat={() => newChat()}
              onRenameChat={setRenamingChat}
              onArchiveChat={conversations.archive}
              onSignOut={() => void logOut()}
              onAccount={() => setAccountOpen(true)}
              onCreate={() => setCreating(true)}
            />
          )}
          <div
            className={`mt-main ${onTripPage ? "trip-page" : ""} ${onChatPage ? "chat-page" : ""}`}
            id="mt-main"
            tabIndex={-1}
          >
            {identity.error ? (
              <div role="alert" className="account-session-notice">
                <p>{identity.error}</p>
                <button type="button" onClick={() => void identity.refresh()}>
                  Retry sign-in check
                </button>
              </div>
            ) : !planner.hydrated ? (
              <div className="mt-loading" role="status">
                <AssistantMark />
                <span>Opening your travel space…</span>
              </div>
            ) : (
              <>
                {provider.requiresSignIn && (path === "/explore" || path === "/discover") && (
                  <aside className="hosted-signin-banner" aria-label="Personal recommendations">
                    <div>
                      <strong>Find places that feel like you.</strong>
                      <p>
                        Sign in for Qloo recommendations and AI planning. Your saved places stay
                        here.
                      </p>
                    </div>
                    <button
                      type="button"
                      className="button button-primary"
                      onClick={() => setAccountOpen(true)}
                    >
                      Sign in to find your places
                    </button>
                  </aside>
                )}
                {path === "/discover" && (
                  <>
                    <HomeFeed
                      trip={trip}
                      onCreate={() => setCreating(true)}
                      onTaste={openTaste}
                      onCity={chooseCity}
                      onCategory={(name) => {
                        if (name === "Trips") router.push("/trips");
                        else {
                          const types: Record<string, string> = {
                            Eats: "restaurant",
                            Experiences: "experience",
                            Stays: "stay",
                          };
                          const type = types[name];
                          router.push(type ? `/explore?type=${type}` : "/explore");
                        }
                      }}
                      {...commonPlaces}
                    />
                    <EntryComposer onSubmit={startChat} onVoice={() => setVoiceOpen(true)} />
                  </>
                )}
                {path === "/trips" && (
                  <TripsIndex
                    trips={trips}
                    tab="Trips"
                    onCreate={() => setCreating(true)}
                    onOpen={openTrip}
                    onAccountSaves={() => setPanel("account-trips")}
                  />
                )}
                {path === "/receipts" && (
                  <ReceiptsWorkspace
                    key={scope}
                    scope={scope}
                    trips={trips}
                    activeTrip={trip}
                    onSelect={planner.openTrip}
                    onCommand={planner.command}
                    onCreate={() => setCreating(true)}
                    onOpen={(next) => {
                      openTrip(next);
                      setPanel("media");
                    }}
                  />
                )}
                {path === "/saved" && (
                  <CollectionManager
                    key={scope}
                    collections={savedWorkspace.workspace.collections}
                    onCollectionsChange={(collections) =>
                      savedWorkspace.update({ ...savedWorkspace.workspace, collections })
                    }
                    ready={savedWorkspace.writable}
                    error=""
                    account={savedWorkspace.account}
                    syncControls={
                      <SavedSync saved={savedWorkspace} onAccount={() => setAccountOpen(true)} />
                    }
                    onDiscover={(collectionId) =>
                      router.push(collectionId ? `/explore?collection=${collectionId}` : "/explore")
                    }
                    places={saved}
                    {...commonPlaces}
                  />
                )}
                {path === "/settings" && (
                  <Suspense fallback={<p role="status">Opening settings…</p>}>
                    <SettingsWorkspace
                      username={identity.account?.username}
                      profile={profile}
                      settings={preferences.settings}
                      error={preferences.error}
                      onUpdate={preferences.update}
                      onAccount={() => setAccountOpen(true)}
                      onNotice={setNotice}
                      chatBackup={
                        identity.account ? (
                          <ChatBackup
                            key={identity.account.id}
                            accountId={identity.account.id}
                            items={conversations.items}
                            ready={conversations.writable}
                            onRestore={conversations.restoreBackup}
                          />
                        ) : undefined
                      }
                    />
                  </Suspense>
                )}
                {path === "/profile" && (
                  <ProfileWorkspace username={identity.account?.username} profile={profile} />
                )}
                {path === "/calendar" && <CalendarWorkspace trips={trips} onOpen={openCalendar} />}
                {path === "/inspiration" && <Inspiration onCity={chooseCity} />}
                {path === "/explore" && (
                  <ExploreWorkspace
                    key={`${scope}:${trip?.id ?? "no-trip"}`}
                    city={city}
                    trip={trip}
                    tasteProfile={trip?.brief.tasteProfile ?? brief.tasteProfile}
                    collection={discoveryCollection}
                    onCollectionAdd={addToDiscoveryCollection}
                    onCollectionBack={() =>
                      router.push(
                        discoveryCollection
                          ? `/saved?collection=${discoveryCollection.id}`
                          : "/saved",
                      )
                    }
                    configured={provider.qloo}
                    onCommand={planner.command}
                    onTaste={openTaste}
                    {...commonPlaces}
                    onPlace={(place, destination) => {
                      savedLocations.current[place.id] = destination;
                      setSelectedPlace(place);
                    }}
                  />
                )}
                {(onTripPage || onChatPage) &&
                  (mismatchedTrip ? (
                    <EmptyState
                      icon={<BriefcaseBusiness size={38} />}
                      title="Open this trip from your collection"
                      description="This trip isn’t open in the current browser workspace. Sign in to reopen a server-saved trip."
                      action={
                        <button
                          type="button"
                          className="mt-primary"
                          onClick={() => setPanel("account-trips")}
                        >
                          Open saved trips
                        </button>
                      }
                    />
                  ) : (
                    <>
                      {onChatPage && (
                        <header className="mt-workspace-header">
                          <div>
                            <Link
                              href={returnToPlanner ? plannerReturnHref : "/trips"}
                              className="mt-icon"
                              aria-label={returnToPlanner ? "Back to planner" : "Back to trips"}
                            >
                              <ArrowLeft size={19} />
                            </Link>
                            <div>
                              <h1
                                className="full-chat-title"
                                title={activeChat?.title ?? "New chat"}
                              >
                                {activeChat?.title ?? "New chat"}
                              </h1>
                              <small>
                                {chatTrip
                                  ? `${tripTitle(chatTrip)} · ${chatTrip.days.length} days · ${chatTrip.brief.partySize} ${chatTrip.brief.partySize === 1 ? "traveler" : "travelers"} · Draft v${chatTrip.version}`
                                  : "Your personal travel assistant"}
                              </small>
                            </div>
                          </div>
                          <div>
                            {trip &&
                              (onChatPage ? (
                                chatTrip && (
                                  <Link
                                    className="mt-pill"
                                    href={
                                      returnToPlanner ? plannerReturnHref : `/trip/${chatTrip.id}`
                                    }
                                  >
                                    <BriefcaseBusiness size={16} />
                                    Trip
                                  </Link>
                                )
                              ) : (
                                <button
                                  className="mt-pill"
                                  type="button"
                                  onClick={() => newChat("", trip)}
                                >
                                  <MessageCircle size={16} />
                                  Chat
                                </button>
                              ))}
                            <button
                              className="mt-icon"
                              type="button"
                              aria-label="Share"
                              disabled={onChatPage ? !chatTrip : !trip}
                              onClick={() => setPanel("share")}
                            >
                              <Share2 size={18} />
                            </button>
                          </div>
                        </header>
                      )}
                      {onChatPage ? (
                        <div className="mt-conversation-view">
                          {!conversations.ready || path === "/chat" || path === "/chat/new" ? (
                            <p role="status">Opening chat…</p>
                          ) : activeChat ? (
                            <>
                              {conversations.error && (
                                <p role="alert" className="mt-inline-error">
                                  {conversations.error}
                                </p>
                              )}
                              <ChatPanel
                                key={`${scope}:${activeChat.id}`}
                                trip={chatTrip}
                                configured={provider.openai}
                                available={chatAvailable}
                                unavailableReason={chatUnavailableReason}
                                onSignIn={chatSignIn}
                                autoSendInitialMessage={activeChat.id !== heldPendingChatId}
                                onCommand={planner.command}
                                onPlanTrip={(request) => planFromChat(request, activeChat.id)}
                                preferences={preferences.settings.assistant}
                                travelPreferences={
                                  preferences.ready &&
                                  !preferences.error &&
                                  preferences.settings.assistant.memory &&
                                  profile
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
                                    : undefined
                                }
                                initialMessages={activeChat.messages}
                                onMessagesChange={(messages) =>
                                  conversations.updateMessages(activeChat.id, messages)
                                }
                                initialMessage={activeChat.pendingMessage}
                                onInitialMessageSent={() =>
                                  conversations.consumePending(activeChat.id)
                                }
                              />
                            </>
                          ) : (
                            <EmptyState
                              icon={<MessageCircle size={38} />}
                              title="Chat not found"
                              description="Open a conversation from Chats or start a new one."
                              action={
                                <button
                                  type="button"
                                  className="mt-primary"
                                  onClick={() => newChat()}
                                >
                                  New chat
                                </button>
                              }
                            />
                          )}
                        </div>
                      ) : (
                        trip && (
                          <>
                            <TripOverview
                              key={trip.id}
                              trip={trip}
                              chats={conversations.items}
                              username={identity.account?.username}
                              onPanel={setPanel}
                              onTitleEdit={() => setTitleEdit(true)}
                              onPlace={setSelectedPlace}
                              onSubmit={startChat}
                              onVoice={() => setVoiceOpen(true)}
                              onNewChat={() => newChat("", trip)}
                              canUndo={planner.canUndo}
                              onUndo={planner.undoLast}
                            />
                          </>
                        )
                      )}
                    </>
                  ))}
                {path === "/chats" && (
                  <div className="mt-page-content">
                    <div className="mt-page-heading">
                      <h1>Your chats</h1>
                      <Link className="mt-primary" href="/chat/new">
                        <Plus size={17} />
                        New chat
                      </Link>
                    </div>
                    {trip ? (
                      <Link className="mt-chat-list-item" href={`/chat/${trip.id}`}>
                        <MessageCircle size={22} />
                        <span>
                          <strong>{tripTitle(trip)}</strong>
                          <small>Continue planning your trip</small>
                        </span>
                        <ChevronRight size={18} />
                      </Link>
                    ) : (
                      <EmptyState
                        icon={<MessageCircle size={38} />}
                        title="Let’s talk travel"
                        description="Ask a question or start planning your next adventure."
                        action={
                          <Link className="mt-primary" href="/chat/new">
                            Start a chat
                          </Link>
                        }
                      />
                    )}
                  </div>
                )}
                {path.startsWith("/agents") && (
                  <AgentManager
                    key={scope}
                    storageKey={`tastip.reference.agents:${scope}`}
                    manage={path === "/agents/manage"}
                    onChat={startChat}
                  />
                )}
                {path === "/updates" && (
                  <div className="mt-page-content">
                    <div className="mt-page-heading">
                      <h1>Updates</h1>
                    </div>
                    <EmptyState
                      icon={<Bell size={38} />}
                      title="You’re all caught up"
                      description="Updates about your travel plans will appear here."
                    />
                  </div>
                )}
                {path === "/create" && (
                  <CreatorHub
                    key={scope}
                    username={profile?.firstName ?? identity.account?.username ?? "Guest"}
                    storageKey={`tastip.reference.guides:${scope}`}
                    places={trip?.places ?? saved}
                  />
                )}
                {["/help", "/about", "/contact", "/terms", "/privacy"].includes(path) && (
                  <div className="mt-page-content">
                    <h1>
                      {path === "/help"
                        ? "How can we help?"
                        : path === "/privacy"
                          ? "Your privacy"
                          : path === "/terms"
                            ? "About this prototype"
                            : "Tastip"}
                    </h1>
                    <p className="mt-page-intro">
                      Tastip is an independent travel-planning prototype. Guest drafts and travel
                      preferences are stored on this device. Account saves use Tastip’s own server.
                      This app is not affiliated with Mindtrip and does not make reservations.
                    </p>
                    <Link href="/home" className="mt-primary">
                      Back to home
                    </Link>
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
      {creating && (
        <TripDialog
          brief={brief}
          firstName={profile?.firstName ?? identity.account?.username}
          initialPrompt={createPrompt}
          onCreate={create}
          onFindPlaces={beginPlanning}
          onClose={() => {
            setCreating(false);
            setChatPlanning(null);
          }}
        />
      )}
      {planning && (
        <TripGenerationReview
          key={`${scope}:${planning.source.chatId ?? "new"}`}
          brief={planning.brief}
          route={planning.route}
          configured={provider.qloo}
          currentTrip={trip}
          previous={planning.source}
          onAccept={acceptPlannedTrip}
          onBack={() => setPlanning(null)}
          onClose={() => {
            setPlanning(null);
            setCreating(false);
            setChatPlanning(null);
          }}
        />
      )}
      {chatPlanning && (
        <ConversationPlanning
          key={chatPlanning.id}
          request={chatPlanning}
          planner={planner}
          conversations={conversations}
          configured={provider.qloo}
          firstName={profile?.firstName ?? identity.account?.username}
          onClose={() => setChatPlanning(null)}
          onNotice={setNotice}
          onAccepted={(prepared, chatId) => {
            setChatPlanning(null);
            router.push(
              returnToPlanner ? "/" : chatId ? `/chat/${chatId}` : `/trip/${prepared.id}`,
            );
          }}
        />
      )}
      {tasteOpen && (
        <TasteDialog
          destinationId={brief.destinationId}
          destinationName={briefDestination(brief)?.name ?? city.name}
          destination={briefDestination(brief) ?? city}
          configured={provider.qloo}
          initialSeeds={trip?.brief.tasteProfile?.seeds ?? brief.tasteProfile?.seeds ?? []}
          initialProfile={trip?.brief.tasteProfile ?? brief.tasteProfile}
          excludedIds={trip ? feedbackTasteSignals(trip).excludedIds : []}
          replacingDraft={Boolean(trip)}
          onClose={() => setTasteOpen(false)}
          onCreate={(places, warnings, tasteProfile) => {
            if (
              planner.createFromPlaces(places, warnings, tasteProfile, undefined, {
                ...brief,
                tasteProfile,
              })
            ) {
              setTasteOpen(false);
              setPendingCreate(true);
            }
          }}
        />
      )}
      {selectedPlace && planner.hydrated && (
        <Venue
          place={selectedPlace}
          trip={trip}
          saved={savedIds.includes(selectedPlace.id)}
          onSave={() => savePlace(selectedPlace)}
          addLabel={
            collectionDiscovery
              ? discoveryCollection
                ? discoveryCollection.placeIds.includes(selectedPlace.id)
                  ? `In ${discoveryCollection.name}`
                  : `Add to ${discoveryCollection.name}`
                : "Collection unavailable"
              : undefined
          }
          addDisabled={
            collectionDiscovery &&
            (!discoveryCollection ||
              !savedWorkspace.writable ||
              discoveryCollection.placeIds.includes(selectedPlace.id))
          }
          onAdd={() => {
            if (!collectionDiscovery) {
              addPlace(selectedPlace);
              return;
            }
            const destination =
              savedLocations.current[selectedPlace.id] ??
              savedWorkspace.workspace.places.find((item) => item.place.id === selectedPlace.id)
                ?.destination;
            if (destination) addToDiscoveryCollection(selectedPlace, destination);
            else setNotice("Reopen this place from collection discovery before adding it.");
          }}
          onClose={() => setSelectedPlace(null)}
        />
      )}
      {schedulingPlace && trip && (
        <AddPlace
          key={`${scope}:${trip.id}:${schedulingPlace.id}`}
          trip={trip}
          place={schedulingPlace}
          preferredDayId={planningDay!.id}
          onCommand={planner.command}
          onClose={() => setSchedulingPlace(null)}
          onRoute={() => {
            setSchedulingPlace(null);
            setSelectedPlace(null);
            setPanel("route");
          }}
          onAdded={(dayId, stopId) => {
            setSchedulingPlace(null);
            setSelectedPlace(null);
            openCalendar(trip, dayId, stopId);
          }}
        />
      )}
      {panel === "media" && trip && (
        <MediaPanel
          key={`${scope}:${trip.id}`}
          scope={scope}
          trip={trip}
          onCommand={planner.command}
          onClose={() => setPanel(null)}
          onShare={() => setPanel("share")}
        />
      )}
      {panel === "calendar" && trip && (
        <TripCalendar
          key={`${scope}:${trip.id}`}
          trip={trip}
          dayId={planningDay!.id}
          onOpen={openCalendar}
          onClose={() => setPanel(null)}
          onDates={() => setPanel("route")}
          onCommand={planner.command}
        />
      )}
      {panel && ["itinerary", "ideas"].includes(panel) && trip && (
        <Itinerary
          key={`${trip.id}:${panel}`}
          trip={trip}
          mode={panel as "itinerary" | "ideas"}
          initialStopId={calendarVisitId}
          onCommand={planner.command}
          onPlace={setSelectedPlace}
          onClose={() => setPanel(null)}
          onShare={() => setPanel("share")}
          dayId={planningDay!.id}
          onDayChange={setPlanningDayId}
          onTimeline={(dayId) => {
            setPlanningDayId(dayId);
            setPanel("itinerary");
          }}
          onIdeas={(dayId) => {
            setPlanningDayId(dayId);
            setPanel("ideas");
          }}
          onFind={(dayId) => {
            if (dayId) setPlanningDayId(dayId);
            setPanel("find");
          }}
        />
      )}
      {panel && !["itinerary", "ideas", "calendar", "media"].includes(panel) && (
        <Modal
          title={
            panel === "chats"
              ? "Chats"
              : panel === "share"
                ? "Share trip"
                : panel === "account-trips"
                  ? "Saved trips"
                  : panel === "find"
                    ? "Find places"
                    : panel === "costs"
                      ? "Planned costs"
                      : panel === "pack"
                        ? "Travel pack"
                        : panel === "route"
                          ? "Trip details"
                          : panel === "bookings"
                            ? "Bookings"
                            : "Trip preferences"
          }
          onClose={() => setPanel(null)}
          className="mt-tools-dialog"
        >
          {panel === "chats" && trip ? (
            <>
              <div className="mt-page-heading">
                <h1>Chats</h1>
                <button type="button" className="mt-primary" onClick={() => newChat("", trip)}>
                  <Plus size={17} />
                  New chat
                </button>
              </div>
              {conversations.items
                .filter((chat) => chat.tripId === trip.id && !chat.archived)
                .map((chat) => (
                  <Link
                    className="mt-chat-list-item"
                    key={chat.id}
                    href={`/chat/${chat.id}`}
                    onClick={() => setPanel(null)}
                  >
                    <MessageCircle size={20} />
                    <span>
                      <strong>{chat.title}</strong>
                      <small>{chat.messages.length} messages</small>
                    </span>
                    <ChevronRight size={18} />
                  </Link>
                ))}
              {!conversations.items.some((chat) => chat.tripId === trip.id && !chat.archived) && (
                <EmptyState
                  icon={<MessageCircle size={34} />}
                  title="Talk through your trip"
                  description="Keep your questions and ideas together with this trip."
                />
              )}
            </>
          ) : panel === "account-trips" || panel === "share" ? (
            <>
              <h1>{panel === "share" ? "Share trip" : "Your saved trips"}</h1>
              <RemoteTrips
                key={`remote:${scope}:${trip?.id ?? "none"}`}
                trip={trip}
                account={identity.account}
                onSignIn={() => setAccountOpen(true)}
                onOpen={openTrip}
              />
              {panel === "account-trips" && (
                <TripLibrary storageKey={planner.libraryKey} trip={trip} onOpen={openTrip} />
              )}
            </>
          ) : trip ? (
            <>
              {panel === "find" && (
                <>
                  <h1>Find your kind of places</h1>
                  <CityRecommendations
                    actionRef={recommendationAction}
                    trip={trip}
                    dayId={planningDay!.id}
                    configured={provider.qloo}
                    onCommand={planner.command}
                    onTaste={() => {
                      setPanel(null);
                      openTaste();
                    }}
                  />
                </>
              )}
              {panel === "route" && (
                <>
                  <h1>Trip details</h1>
                  <RoutePlan
                    key={trip.id}
                    trip={trip}
                    dayId={planningDay!.id}
                    onCommand={planner.command}
                  />
                </>
              )}
              {panel === "costs" && (
                <>
                  <h1>Planned costs</h1>
                  <CostPlanner key={trip.id} trip={trip} onCommand={planner.command} />
                </>
              )}
              {panel === "pack" && <TravelPack trip={trip} />}
              {panel === "bookings" && (
                <>
                  <h1>Bookings</h1>
                  <p className="mt-page-intro">
                    Keep your stays together. Hotel suggestions are ideas, not reservations.
                  </p>
                  <LodgingPanel
                    dayId={planningDay!.id}
                    trip={trip}
                    configured={provider.qloo}
                    onCommand={planner.command}
                    onTaste={openTaste}
                  />
                </>
              )}
              {panel === "preferences" && (
                <>
                  <h1>Trip preferences</h1>
                  <TripBriefEditor
                    key={`brief:${trip.id}`}
                    trip={trip}
                    onCommand={planner.command}
                  />
                  <TripTravelers
                    key={`travelers:${trip.id}`}
                    trip={trip}
                    onCommand={planner.command}
                  />
                  <TripDetails
                    key={`details:${trip.id}`}
                    trip={trip}
                    onCommand={planner.command}
                    showTravelers={false}
                  />
                  <button
                    type="button"
                    className="mt-pill outlined"
                    onClick={() => setPanel("costs")}
                  >
                    Manage planned costs
                  </button>
                  <p className="mt-muted">{trip.brief.interests.join(" · ")}</p>
                  <dl className="mt-preferences-list">
                    <dt>Pace</dt>
                    <dd>{trip.brief.pace}</dd>
                    <dt>Travelers</dt>
                    <dd>{trip.brief.partySize}</dd>
                    <dt>Dietary preferences</dt>
                    <dd>{trip.brief.tasteProfile?.dietary?.join(", ") || "Not specified"}</dd>
                  </dl>
                  <button
                    type="button"
                    className="mt-primary"
                    onClick={() => {
                      setPanel(null);
                      openTaste();
                    }}
                  >
                    Update trip preferences
                  </button>
                  <Link href="/setup" className="mt-pill outlined">
                    Edit personal travel style
                  </Link>
                </>
              )}
            </>
          ) : (
            <EmptyState
              icon={<BriefcaseBusiness size={35} />}
              title="Start with a trip"
              description="Create a plan to use these tools."
              action={
                <button
                  type="button"
                  className="mt-primary"
                  onClick={() => {
                    setPanel(null);
                    setCreating(true);
                  }}
                >
                  Create a trip
                </button>
              }
            />
          )}
        </Modal>
      )}
      {renamingChat && (
        <TextDialog
          title="Rename chat"
          label="Chat name"
          initial={renamingChat.title}
          onClose={() => setRenamingChat(null)}
          onSave={(title) => {
            if (conversations.rename(renamingChat.id, title)) setRenamingChat(null);
          }}
        />
      )}
      {titleEdit && trip && (
        <TextDialog
          title="Edit trip title"
          label="Trip title"
          initial={tripTitle(trip)}
          onClose={() => setTitleEdit(false)}
          onSave={(title) => {
            if (planner.command([{ type: "set-trip-title", title }], trip.version, trip.id))
              setTitleEdit(false);
          }}
        />
      )}
      {voiceOpen && (
        <Modal
          title="Talk to Tastip"
          onClose={() => setVoiceOpen(false)}
          className="mt-tools-dialog mt-voice-dialog"
        >
          <div className="mt-conversation-view">
            <ChatPanel
              trip={trip}
              configured={provider.openai}
              available={chatAvailable}
              unavailableReason={chatUnavailableReason}
              onSignIn={chatSignIn}
              onCommand={planner.command}
              preferences={preferences.settings.assistant}
            />
          </div>
        </Modal>
      )}
      {accountOpen && (
        <AccountDialog
          account={identity.account}
          hasDraft={Boolean(trip)}
          onClose={() => setAccountOpen(false)}
          onAuthenticated={async (account, keepDraft, handoff) => {
            if (!handoff.isCurrent()) return;
            setHeldPendingChatId(activeChat?.id ?? null);
            let handoffNotice: string | undefined;
            if (keepDraft && trip) {
              try {
                const key = `tastip.trip.v1:${account.id}`;
                if (localStorage.getItem(key) === null) {
                  const missing = trip.media?.length
                    ? await retainMediaForAccount(
                        scope,
                        account.id,
                        trip.media,
                        handoff.signal,
                        handoff.isCurrent,
                      )
                    : 0;
                  if (!handoff.isCurrent()) return;
                  // Media retention yields to other tabs. Their newer account draft wins;
                  // the guest original remains available in its own workspace.
                  if (localStorage.getItem(key) === null) {
                    localStorage.setItem(key, JSON.stringify(trip));
                    if (missing)
                      handoffNotice =
                        "Signed in. Some retained files are only available in your guest workspace on this device.";
                  } else {
                    handoffNotice =
                      "Signed in. Another tab saved an account draft while files were being retained. That draft and your guest original were kept.";
                  }
                }
              } catch {
                if (!handoff.isCurrent()) return;
                handoffNotice =
                  "Signed in. Keep a backup of your current draft before closing this browser.";
              }
            }
            if (!handoff.isCurrent()) return;
            setSelectedPlace(null);
            setPanel(null);
            accountHandoffNotice.current = handoffNotice
              ? { owner: account.id, message: handoffNotice }
              : null;
            identity.setAccount(account);
            setAccountOpen(false);
          }}
          onSignedOut={signOut}
        />
      )}
      {notice && (
        <div className="mt-toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            type="button"
            className="mt-icon"
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={16} />
          </button>
        </div>
      )}
    </main>
  );
}
