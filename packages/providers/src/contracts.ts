import type {
  Destination,
  LodgingCandidate,
  Place,
  TasteProfile,
  TransferTiming,
  TripOperation,
} from "@tastip/domain";
import type { AssistantPreferences } from "./assistant-preferences";

export type ConversationMessage = { role: "user" | "assistant"; content: string };

/** Minimal accepted-plan context; command logs and previous snapshots stay in the app. */
export type TripContext = {
  tripId?: string;
  version?: number;
  destinationId: string;
  destination?: Destination;
  origin?: string;
  days: number;
  partySize: number;
  budget?: number | null;
  currency?: string;
  pace?: "slow" | "balanced" | "full";
  interests: string[];
  tasteProfile?: TasteProfile;
  lodgings?: {
    name: string;
    city: string;
    arrival: string | null;
    departure: string | null;
    status: "idea";
  }[];
  calendar?: { id?: string; date: string | null; city: string; timeZone: string }[];
  transfers?: {
    date: string | null;
    from: string;
    to: string;
    mode: string;
    verified: false;
    timing?: TransferTiming & { departureTimeZone: string; arrivalTimeZone: string };
  }[];
  places?: { id: string; name: string }[];
  stops: {
    id?: string;
    placeId?: string;
    name: string;
    day: string;
    time: string;
    durationMinutes?: number;
    pinned?: boolean;
    timeLocked?: boolean;
    sample: boolean;
    source?: Place["source"];
  }[];
};

export type ChatProposal = {
  id: string;
  tripId: string;
  baseVersion: number;
  summary: string;
  operations: TripOperation[];
};
export type ConversationReply = {
  message: string;
  provider: "openai" | "local";
  proposal?: ChatProposal;
};

export interface ConversationProvider {
  reply(input: {
    message: string;
    history?: ConversationMessage[];
    preferences?: AssistantPreferences;
    travelPreferences?: string;
    context?: TripContext;
    signal?: AbortSignal;
    /** Cumulative provisional text only; proposals are returned after final validation. */
    onText?: (text: string) => void;
  }): Promise<ConversationReply>;
}

export interface VoiceProvider {
  createSession(
    context?: TripContext,
    signal?: AbortSignal,
    preferences?: AssistantPreferences,
  ): Promise<{
    clientSecret: string;
    expiresAt: number;
    model: string;
  }>;
}

export type TasteQuery = {
  entityIds: string[];
  lat: number;
  lng: number;
  radiusMetres?: number;
  take?: number;
};

export type TasteResult = {
  queryId: string;
  provider: "qloo";
  retrievedAt: string;
  places: Place[];
  lodgings?: Omit<LodgingCandidate, "destinationId">[];
  warnings: string[];
};

export interface TasteProvider {
  search(
    query: string,
    signal?: AbortSignal,
  ): Promise<
    {
      id: string;
      name: string;
      type: string;
      description: string | null;
    }[]
  >;
  recommend(query: TasteQuery, signal?: AbortSignal): Promise<TasteResult>;
}

export class ProviderError extends Error {
  constructor(
    public readonly code:
      | "PROVIDER_NOT_CONFIGURED"
      | "PROVIDER_UNAVAILABLE"
      | "INVALID_PROVIDER_RESPONSE"
      | "INVALID_TASTE_QUERY",
    message: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}
