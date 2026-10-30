import type { PlaceFacts } from "./facts";
import type { LodgingChoice, LodgingIdea } from "./lodging";
import type { OwnPlace } from "./own-places";
export type Destination = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lng: number;
  timeZone: string;
};

export type TripBrief = {
  destinationId: string;
  destination?: Destination;
  origin: string;
  originDestination?: Destination;
  days: number;
  partySize: number;
  /** Whole-trip activity budget for the entire party; excludes travel and lodging. */
  budget: number | null;
  currency: string;
  pace: "slow" | "balanced" | "full";
  interests: string[];
  details?: TripDetails;
  /** Volunteered, explicitly confirmed cultural favorites; not inferred identity. */
  tasteProfile?: TasteProfile;
};

export type TripDetails = {
  request: string;
  travelers: { adults: number; children: number; infants: number; pets: number };
  flexibleMonths: string[];
};

export type TasteSeed = { id: string; name: string; type: string };
export type TasteProfile = {
  seeds: TasteSeed[];
  dayStyle: string;
  rhythm?: "early" | "balanced" | "late";
  dietary?: string[];
  walking?: "short" | "moderate" | "long";
  lodging?: string;
  categories: Place["category"][];
};

export type Place = {
  id: string;
  destinationId?: string;
  name: string;
  category: "cafe" | "culture" | "food" | "outdoors" | "shop";
  description: string;
  lat: number;
  lng: number;
  source: "demo" | "qloo" | "traveler";
  taste?: { queryId: string; rank: number; score?: number };
  practical: { hours: "unknown"; cost: "unknown" };
  facts?: PlaceFacts;
};

/** A visit identity is independent of the canonical place identity. */
export type TripStop = {
  id: string;
  placeId: string;
  dayId: string;
  startTime: string;
  durationMinutes: number;
  pinned: boolean;
  timeLocked: boolean;
  /** Private traveler note for this visit, never provider facts. */
  note?: string;
  feedback?: "more" | "less";
  /** Query-local evidence that selected this visit; place identity can recur across queries. */
  selection?: { queryId: string; rank: number; score?: number };
};

export type TripDay = { id: string; label: string; date: string | null; note?: string };

export type CityStay = {
  id: string;
  destinationId: string;
  days: number;
  destination?: Destination;
};
export type TransferMode = "undecided" | "train" | "flight" | "car" | "bus";
export type LocalTravelTime = { date: string; time: string; utcOffset?: string };
/** Times entered by the traveler, not a verified service or reservation. */
export type TransferTiming = {
  source: "traveler";
  departure: LocalTravelTime;
  arrival: LocalTravelTime;
};
export type CityTransfer = {
  id: string;
  fromStayId: string;
  toStayId: string;
  mode: TransferMode;
  timing?: TransferTiming;
};
/** Traveler intent only; no availability, fare or booking is implied. */
export type TripRoute = {
  startDate: string | null;
  stays: CityStay[];
  transfers: CityTransfer[];
};

export type CostCurrency =
  | "USD"
  | "EUR"
  | "GBP"
  | "INR"
  | "JPY"
  | "CAD"
  | "AUD"
  | "CHF"
  | "DKK"
  | "SGD";
export type TripCost = {
  id: string;
  label: string;
  category: "activity" | "lodging" | "transport" | "other";
  currency: CostCurrency;
  unitAmountMinor: number;
  quantity: number;
  appliesTo: "party" | "each-traveler";
  source: "traveler";
};

export type TripMedia = {
  id: string;
  name: string;
  addedAt: string;
  purpose: "media" | "receipt";
} & (
  | { kind: "link"; url: string }
  | {
      kind: "file";
      mimeType: "image/jpeg" | "image/png" | "image/webp" | "application/pdf";
      size: number;
    }
);

export type Trip = {
  id: string;
  title?: string;
  version: number;
  brief: TripBrief;
  places: Place[];
  days: TripDay[];
  stops: TripStop[];
  route?: TripRoute;
  lodgings?: LodgingChoice[];
  /** Private attachment metadata. File bytes live in the owning device's asset store. */
  media?: TripMedia[];
  costs?: TripCost[];
  appliedCommandIds: string[];
  updatedAt: string;
  /** Persist with the trip to retain idempotency across refresh/reconnect. */
  commandLog?: CommandReceipt[];
};

export type TripSnapshot = Omit<Trip, "commandLog">;

export type TripOperation =
  | { type: "set-trip-request"; request: string }
  | { type: "set-travelers"; travelers: TripDetails["travelers"] }
  | { type: "add-media"; media: TripMedia }
  | { type: "remove-media"; mediaId: string }
  | { type: "set-party-size"; partySize: number }
  | { type: "set-pace"; pace: TripBrief["pace"] }
  | { type: "set-activity-budget"; currency: CostCurrency; amountMinor: number | null }
  | { type: "set-own-place"; place: OwnPlace }
  | { type: "remove-place-idea"; placeId: string }
  | { type: "set-title"; title: string }
  | { type: "set-trip-title"; title: string }
  | { type: "set-cost"; cost: TripCost }
  | { type: "remove-cost"; costId: string }
  | { type: "select-lodging"; stayId: string; candidate: LodgingIdea }
  | { type: "remove-lodging"; stayId: string }
  | { type: "add-candidates"; destinationId: string; places: Place[] }
  | { type: "add-stop"; stop: TripStop }
  | { type: "set-duration"; stopId: string; durationMinutes: number }
  | { type: "set-stop-note"; stopId: string; note: string }
  | { type: "annotate-day"; dayId: string; label: string; note: string }
  | { type: "set-route"; route: TripRoute }
  | { type: "rate-stop"; stopId: string; feedback: "more" | "less" | null }
  | { type: "pin-stop"; stopId: string; pinned: boolean }
  | { type: "lock-time"; stopId: string; timeLocked: boolean }
  | { type: "remove-stop"; stopId: string }
  | { type: "move-stop"; stopId: string; dayId: string; startTime: string }
  | { type: "replace-stop"; stopId: string; placeId: string }
  | { type: "set-start-time"; stopId: string; startTime: string };

export type TripCommand = {
  id: string;
  baseVersion: number;
  operations: TripOperation[];
};

export type CommandReceipt = {
  commandId: string;
  fingerprint: string;
  beforeVersion: number;
  afterVersion: number;
  before: TripSnapshot;
  affectedStopIds: string[];
};

export type DomainIssue = {
  code: string;
  message: string;
  stopId?: string;
};

export type CommandResult =
  | { ok: true; trip: Trip; receipt: CommandReceipt; replayed: boolean }
  | { ok: false; error: DomainIssue };
