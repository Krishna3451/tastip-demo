"use client";

import type { Trip, TripBrief, TripRoute } from "@tastip/domain";
import { useState } from "react";
import type { usePlanner } from "../planner/use-planner";
import { TripDialog } from "./trip-dialog";
import { TripGenerationReview } from "./trip-generation-review";
import type { useConversations } from "./use-conversations";

export type ConversationPlanningRequest = {
  id: string;
  scope: string;
  tripId: string | null;
  version: number | null;
  chatId: string;
  prompt: string;
};

/** The same reviewed creation flow serves conversation pages and the globe planner. */
export function ConversationPlanning({
  request,
  planner,
  conversations,
  configured,
  firstName,
  theme = "reference",
  onAccepted,
  onClose,
  onNotice,
}: {
  request: ConversationPlanningRequest;
  planner: ReturnType<typeof usePlanner>;
  conversations: ReturnType<typeof useConversations>;
  configured: boolean;
  firstName?: string;
  theme?: "planner" | "reference";
  onAccepted: (trip: Trip, chatId?: string) => void;
  onClose: () => void;
  onNotice: (message: string) => void;
}) {
  const [review, setReview] = useState<{ brief: TripBrief; route: TripRoute } | null>(null);
  function reviewDetails(brief: TripBrief, route?: TripRoute) {
    if (route) setReview({ brief, route });
  }
  function accept(prepared: Trip) {
    if (request.scope !== planner.libraryKey || !conversations.writable) return false;
    if (!planner.acceptPreparedTrip(prepared, request)) return false;
    const linked = conversations.associateTrip(request.chatId, prepared.id);
    if (!linked)
      onNotice("Your trip is saved. Its conversation could not be linked; your chat copy is kept.");
    onAccepted(prepared, linked ? request.chatId : undefined);
    return true;
  }
  return (
    <div className={theme === "planner" ? "planner-conversation-planning" : undefined}>
      <TripDialog
        brief={planner.brief}
        firstName={firstName}
        initialPrompt={request.prompt.slice(0, 2000)}
        submitLabel="Review trip"
        explainPlanning
        onCreate={reviewDetails}
        onClose={onClose}
      />
      {review && (
        <TripGenerationReview
          brief={review.brief}
          route={review.route}
          configured={configured}
          currentTrip={planner.trip}
          previous={request}
          onAccept={accept}
          onBack={() => setReview(null)}
          onClose={onClose}
        />
      )}
    </div>
  );
}
