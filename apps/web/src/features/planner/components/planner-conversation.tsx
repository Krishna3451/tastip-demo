"use client";

import type { Trip } from "@tastip/domain";
import type { AssistantPreferences } from "@tastip/providers";
import { ArrowUpRight, MapPin, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import type { Conversation } from "../lib/conversations";
import discoveryStyles from "../styles/day-suggestions.module.css";
import type { usePlanner } from "../use-planner";
import { ChatPanel } from "./chat-panel";
import { DaySuggestions } from "./day-suggestions";

export function PlannerConversation({
  chat,
  trip,
  open,
  configured,
  available,
  unavailableReason,
  onSignIn,
  autoSendInitialMessage,
  preferences,
  travelPreferences,
  error,
  fullChatHref,
  onMessagesChange,
  onConsumePending,
  onPlanTrip,
  onCommand,
  onNewChat,
  onClose,
  dayId,
  scope,
  qlooConfigured,
  onSuggestionAdded,
}: {
  chat: Conversation | undefined;
  trip: Trip | null;
  open: boolean;
  configured: boolean;
  available: boolean;
  unavailableReason?: string;
  onSignIn?: () => void;
  autoSendInitialMessage?: boolean;
  preferences: AssistantPreferences;
  travelPreferences?: string;
  error?: string | null;
  fullChatHref: string;
  onMessagesChange: (id: string, messages: Conversation["messages"]) => void;
  onConsumePending: (id: string) => void;
  onPlanTrip: (request: string, chatId: string) => void;
  onCommand: ReturnType<typeof usePlanner>["command"];
  onNewChat: () => void;
  onClose: () => void;
  dayId: string;
  scope: string;
  qlooConfigured: boolean;
  onSuggestionAdded: (dayId: string, stopId: string) => void;
}) {
  const panel = useRef<HTMLElement>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const suggestionsId = useId();
  const selectedDay = trip?.days.find((day) => day.id === dayId);
  const hasTrip = Boolean(trip);
  const Heading = trip ? "h2" : "h1";
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      panel.current?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
      if (!hasTrip || window.matchMedia("(max-width: 1100px)").matches)
        panel.current?.scrollIntoView({ block: "start", behavior: "instant" });
    });
    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) {
        event.preventDefault();
        onClose();
      }
    }
    const element = panel.current;
    element?.addEventListener("keydown", handleEscape);
    return () => {
      cancelAnimationFrame(frame);
      element?.removeEventListener("keydown", handleEscape);
    };
  }, [open, onClose, hasTrip]);
  return (
    <section
      ref={panel}
      className={`planner-conversation ${suggestionsOpen ? discoveryStyles.expanded : ""}`}
      aria-label="Planner chat"
    >
      <header className="planner-conversation-toolbar">
        <div>
          <span className="eyebrow">LET’S THINK IT THROUGH</span>
          <Heading>{trip ? "Your trip, together." : "A good idea starts here."}</Heading>
          <p>
            {trip
              ? `${trip.days.length} days · Your whole trip is in view`
              : "Tell me what you have in mind."}
          </p>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label="Close planner chat"
          onClick={onClose}
        >
          <X size={18} />
        </button>
      </header>
      <div className="planner-conversation-actions">
        <button type="button" className="button button-quiet" onClick={onNewChat}>
          <Plus size={14} /> New conversation
        </button>
        {chat && (
          <Link href={fullChatHref} className="button button-quiet">
            Full conversation <ArrowUpRight size={14} />
          </Link>
        )}
      </div>
      {trip && selectedDay && (
        <>
          <div className={discoveryStyles.toggle}>
            <button
              type="button"
              className="button button-secondary"
              aria-expanded={suggestionsOpen}
              aria-controls={suggestionsId}
              onClick={() => setSuggestionsOpen((current) => !current)}
            >
              <MapPin size={15} aria-hidden="true" /> Places for {selectedDay.label}
            </button>
          </div>
          <div id={suggestionsId} hidden={!suggestionsOpen}>
            <DaySuggestions
              trip={trip}
              dayId={dayId}
              scope={scope}
              active={open && suggestionsOpen}
              configured={qlooConfigured}
              available={available}
              unavailableReason={unavailableReason}
              onCommand={onCommand}
              onAdded={onSuggestionAdded}
            />
          </div>
        </>
      )}
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      {chat ? (
        <ChatPanel
          key={chat.id}
          trip={trip}
          active={open}
          available={available}
          unavailableReason={unavailableReason}
          onSignIn={onSignIn}
          autoSendInitialMessage={autoSendInitialMessage}
          contained
          configured={configured}
          preferences={preferences}
          travelPreferences={travelPreferences}
          onCommand={onCommand}
          initialMessages={chat.messages}
          initialMessage={chat.pendingMessage}
          onMessagesChange={(messages) => onMessagesChange(chat.id, messages)}
          onInitialMessageSent={() => onConsumePending(chat.id)}
          onPlanTrip={(request) => onPlanTrip(request, chat.id)}
        />
      ) : (
        <p className="planner-conversation-empty" role="status">
          Your conversation will open here. Your saved history stays in your workspace.
        </p>
      )}
    </section>
  );
}
