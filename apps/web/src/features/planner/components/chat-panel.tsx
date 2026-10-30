"use client";

import { applyTripCommand, type Trip, type TripOperation } from "@tastip/domain";
import type { AssistantPreferences } from "@tastip/providers";
import {
  ArrowUp,
  ArrowUpRight,
  Check,
  Headphones,
  Mic,
  MicOff,
  PhoneOff,
  Square,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useVoiceSession } from "@/features/voice/use-voice-session";
import { useProviderFetch } from "@/lib/provider-fetch";
import { tripRequestContext } from "@/lib/trip-context";
import guidance from "../../reference/planning-guidance.module.css";
import { readChatReply } from "../lib/chat-reply";
import { chatTripCreationRequest } from "../lib/chat-trip-request";
import { type ConversationMessage as Message, proposalShape } from "../lib/conversations";

function describeEdit(trip: Trip, operation: TripOperation): string {
  if (!("stopId" in operation)) return "Unsupported edit";
  const stop = trip.stops.find((item) => item.id === operation.stopId);
  const name = trip.places.find((place) => place.id === stop?.placeId)?.name ?? "This visit";
  switch (operation.type) {
    case "set-start-time":
      return `${name}: start at ${operation.startTime}`;
    case "set-duration":
      return `${name}: ${operation.durationMinutes} minutes`;
    case "move-stop":
      return `${name}: ${trip.days.find((day) => day.id === operation.dayId)?.label ?? operation.dayId} at ${operation.startTime}`;
    case "pin-stop":
      return `${name}: ${operation.pinned ? "keep this place" : "unpin place"}`;
    case "lock-time":
      return `${name}: ${operation.timeLocked ? "lock visit time" : "unlock visit time"}`;
    case "remove-stop":
      return `${name}: remove visit`;
    case "replace-stop":
      return `${name}: replace with ${trip.places.find((place) => place.id === operation.placeId)?.name ?? operation.placeId}`;
    case "rate-stop":
      return `${name}: ${operation.feedback === "more" ? "more like this" : operation.feedback === "less" ? "less like this" : "clear preference"}`;
    default:
      return "Unsupported edit";
  }
}
export function ChatPanel({
  trip,
  configured,
  onCommand,
  initialMessage,
  onInitialMessageSent,
  initialMessages = [],
  onMessagesChange,
  preferences,
  travelPreferences,
  onPlanTrip,
  active = true,
  available = true,
  unavailableReason,
  onSignIn,
  autoSendInitialMessage = true,
  contained = false,
}: {
  trip: Trip | null;
  configured: boolean;
  active?: boolean;
  /** Reading history is independent of permission to send text or start voice. */
  available?: boolean;
  unavailableReason?: string;
  onSignIn?: () => void;
  /** Authentication never grants permission to replay a previously held entry. */
  autoSendInitialMessage?: boolean;
  contained?: boolean;
  preferences?: AssistantPreferences;
  travelPreferences?: string;
  onPlanTrip?: (request: string) => void;
  initialMessage?: string;
  initialMessages?: Message[];
  onMessagesChange?: (messages: Message[]) => void;
  onInitialMessageSent?: () => void;
  onCommand?: (
    operations: TripOperation[],
    baseVersion?: number,
    tripId?: string,
    commandId?: string,
  ) => boolean | undefined;
}) {
  const providerFetch = useProviderFetch();
  const [messages, setMessages] = useState<Message[]>(initialMessages);
  const creationRequest = chatTripCreationRequest(messages, Boolean(trip));
  const [draft, setDraft] = useState("");
  const composer = useRef<HTMLTextAreaElement>(null);
  const [pending, setPending] = useState(false);
  const [partialReply, setPartialReply] = useState("");
  const [error, setError] = useState<string | null>(null);
  const lastStoredMessage = initialMessages.at(-1);
  const unanswered = lastStoredMessage?.role === "user" ? lastStoredMessage : null;
  const [replyNotice, setReplyNotice] = useState<string | null>(
    unanswered ? "Your last request has no completed reply. Retry when you’re ready." : null,
  );
  const [retryMessage, setRetryMessage] = useState<Message | null>(unanswered);
  const [proposalErrors, setProposalErrors] = useState<Record<string, string>>({});
  const [voiceOpen, setVoiceOpen] = useState(false);
  const activeRef = useRef(active);
  activeRef.current = active;
  const canRequest = activeRef.current && available;
  const canRequestRef = useRef(canRequest);
  canRequestRef.current = canRequest;
  const request = useRef<{ controller: AbortController; message: Message } | null>(null);
  const currentMessages = useRef(messages);
  currentMessages.current = messages;
  const voice = useVoiceSession({
    enabled: canRequest,
    trip: trip ?? undefined,
    preferences,
    onProposal: (proposal) => {
      if (!canRequestRef.current) return;
      setMessages((current) => [
        ...current,
        {
          id: proposal.id,
          role: "assistant",
          text: "I’ve put your voice suggestion here for review. Your trip stays as it is until you apply it.",
          proposal,
          edits: trip ? proposal.operations.map((operation) => describeEdit(trip, operation)) : [],
        },
      ]);
    },
  });
  useEffect(() => {
    if (canRequest) return;
    const running = request.current;
    request.current = null;
    running?.controller.abort();
    if (running) {
      setRetryMessage(running.message);
      setReplyNotice(
        "Stopped waiting for this reply. Your request is kept; retry when you’re ready.",
      );
    }
    setPending(false);
    setPartialReply("");
    voice.end();
    setVoiceOpen(false);
  }, [canRequest, voice.end]);
  const initialSent = useRef(false);
  // An authentication change must not replay a request the guest could only read.
  const initialSignInBlocked = useRef(false);
  if (onSignIn || !autoSendInitialMessage) initialSignInBlocked.current = true;
  const messagesChanged = useRef(onMessagesChange);
  messagesChanged.current = onMessagesChange;
  useEffect(() => {
    messagesChanged.current?.(messages);
  }, [messages]);
  const conversationEnd = useRef<HTMLDivElement>(null);
  const followReplies = useRef(true);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Scroll when the message list or pending indicator changes.
  useEffect(() => {
    if (!active) return;
    if (contained) {
      if (followReplies.current) {
        const thread = conversationEnd.current?.closest<HTMLElement>(".conversation");
        thread?.scrollTo({ top: thread.scrollHeight, behavior: "instant" });
      }
    } else conversationEnd.current?.scrollIntoView({ block: "end", behavior: "instant" });
  }, [messages, pending, partialReply, active, contained]);
  useEffect(() => () => request.current?.controller.abort(), []);
  // biome-ignore lint/correctness/useExhaustiveDependencies: A new accepted trip version invalidates an in-flight answer against the previous snapshot.
  useEffect(() => {
    const active = request.current;
    request.current = null;
    active?.controller.abort();
    if (active) {
      setRetryMessage(active.message);
      setReplyNotice("Your trip changed. Retry the request with the latest plan.");
    }
    setPending(false);
    setPartialReply("");
  }, [trip?.id, trip?.version]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Send an explicitly supplied entry message only once when this conversation mounts.
  useEffect(() => {
    if (!canRequest || !initialMessage || initialSent.current || initialSignInBlocked.current)
      return;
    let disposed = false;
    // Wait for effect setup to settle: development's effect replay must not consume
    // the pending message and immediately cancel its only request.
    queueMicrotask(() => {
      if (disposed || !canRequestRef.current || request.current || initialSent.current) return;
      initialSent.current = true;
      void submit(initialMessage);
      onInitialMessageSent?.();
    });
    return () => {
      disposed = true;
    };
  }, [initialMessage, canRequest]);
  async function submit(message: string, retryId?: string) {
    if (!canRequestRef.current || !message || request.current) return;
    if (initialSignInBlocked.current && message === initialMessage && !initialSent.current) {
      initialSent.current = true;
      onInitialMessageSent?.();
    }
    const controller = new AbortController();
    const existing = retryId
      ? currentMessages.current.find((item) => item.id === retryId && item.role === "user")
      : undefined;
    const userMessage: Message = existing ?? {
      id: crypto.randomUUID(),
      role: "user",
      text: message,
    };
    request.current = { controller, message: userMessage };
    followReplies.current = true;
    if (!retryId) setDraft("");
    setError(null);
    setReplyNotice(null);
    setRetryMessage(null);
    setPending(true);
    setPartialReply("");
    const history = currentMessages.current.filter((item) => item.id !== userMessage.id);
    if (!existing) setMessages((current) => [...current, userMessage]);
    try {
      const response = await providerFetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          stream: true,
          preferences,
          travelPreferences,
          ...(trip ? { trip: tripRequestContext(trip) } : {}),
          history: history
            .slice(-8)
            .map(({ role, text }) => ({ role, content: text.slice(0, 4000) })),
        }),
        signal: controller.signal,
      });
      const body = await readChatReply(response, (text) => {
        if (
          canRequestRef.current &&
          !controller.signal.aborted &&
          request.current?.controller === controller
        )
          setPartialReply(text);
      });
      if (
        !canRequestRef.current ||
        controller.signal.aborted ||
        request.current?.controller !== controller
      )
        return;
      if (
        typeof body.message !== "string" ||
        (body.proposal !== undefined && !proposalShape(body.proposal))
      )
        throw new Error("The assistant returned an unreadable reply. Your trip is unchanged.");
      setMessages((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          text: body.message,
          ...(body.proposal
            ? {
                proposal: body.proposal,
                edits: trip
                  ? body.proposal.operations.map((operation: TripOperation) =>
                      describeEdit(trip, operation),
                    )
                  : [],
              }
            : {}),
        },
      ]);
    } catch (cause) {
      if (
        canRequestRef.current &&
        !controller.signal.aborted &&
        request.current?.controller === controller
      ) {
        setError(cause instanceof Error ? cause.message : "The assistant could not connect.");
        setRetryMessage(userMessage);
      }
    } finally {
      if (request.current?.controller === controller) {
        request.current = null;
        setPending(false);
        setPartialReply("");
      }
    }
  }
  function stopReply() {
    const active = request.current;
    if (!active) return;
    request.current = null;
    active.controller.abort();
    setPending(false);
    setPartialReply("");
    setRetryMessage(active.message);
    setReplyNotice("Stopped waiting for this reply. Your trip is unchanged.");
  }
  function send(event: React.FormEvent) {
    event.preventDefault();
    void submit(draft.trim());
  }
  function startWith(text: string) {
    if (!canRequestRef.current || pending) return;
    setDraft(text);
    composer.current?.focus();
  }
  function applyProposal(message: Message) {
    const proposal = message.proposal;
    if (!proposal || !trip || message.state || !onCommand) return;
    if (trip.id !== proposal.tripId || trip.version !== proposal.baseVersion) {
      setProposalErrors((current) => ({
        ...current,
        [proposal.id]: "Your plan changed since this suggestion. Ask again using the latest trip.",
      }));
      return;
    }
    const preview = applyTripCommand(trip, {
      id: proposal.id,
      baseVersion: proposal.baseVersion,
      operations: proposal.operations,
    });
    if (!preview.ok) {
      setProposalErrors((current) => ({ ...current, [proposal.id]: preview.error.message }));
      return;
    }
    if (onCommand(proposal.operations, proposal.baseVersion, proposal.tripId, proposal.id)) {
      setMessages((current) =>
        current.map((item) =>
          item.id === message.id
            ? { ...item, state: "applied", acceptedVersion: preview.trip.version }
            : item,
        ),
      );
    } else {
      setProposalErrors((current) => ({
        ...current,
        [proposal.id]:
          "This change was not accepted. Your plan may have changed; review it and ask again.",
      }));
    }
  }
  return (
    <section className="chat-panel" aria-label="Travel conversation">
      <div className="chat-panel-heading">
        <span className="assistant-avatar">
          t<span>✦</span>
        </span>
        <div>
          <strong>Your travel companion</strong>
          <small>
            {!available
              ? "Chat and voice paused"
              : configured
                ? "GPT conversation · reviewed edits"
                : "Local itinerary commands"}
          </small>
        </div>
        <span
          className={`connection-dot ${available && configured ? "online" : ""}`}
          role="img"
          aria-label={!available ? "Paused" : configured ? "Configured" : "Not configured"}
        />
      </div>
      {!available && (
        <p className={onSignIn ? "chat-signin-notice" : "inline-error"} role="alert">
          {unavailableReason ?? "Chat and voice are paused while your preferences are checked."}{" "}
          Your history and composer are kept.{" "}
          {onSignIn ? (
            <button type="button" className="chat-signin-action" onClick={onSignIn}>
              Sign in to Tastip
            </button>
          ) : (
            <>
              <Link href="/settings?section=personalization">Review preferences in Settings</Link>,
              then reload to retry.
            </>
          )}
        </p>
      )}
      <div
        className="conversation"
        aria-live="polite"
        aria-relevant="additions"
        onScroll={(event) => {
          if (!contained) return;
          const thread = event.currentTarget;
          followReplies.current = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 80;
        }}
      >
        <div className="assistant-message">
          <span className="eyebrow">A GOOD PLACE TO START</span>
          <p>
            {trip
              ? "This is your space to make the trip yours. Ask about the plan, or use a visit’s controls to change your draft."
              : "Big cities, quiet corners, or a little of both? Tell me what a good day away feels like to you."}
          </p>
        </div>
        <div className="conversation-note">
          <Check size={14} aria-hidden="true" />
          <span>Your preferences. Your pace. Room for a detour.</span>
        </div>
        {messages.map((message) => (
          <div key={message.id} className={`chat-message ${message.role}-message`}>
            <span className="sr-only">{message.role === "user" ? "You" : "Assistant"}: </span>
            {message.text}
            {message.proposal && (
              <div
                className="chat-proposal"
                style={{
                  marginTop: 12,
                  padding: 14,
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-control)",
                  background: "var(--surface)",
                }}
              >
                <strong>
                  {message.state === "applied"
                    ? `Applied · draft v${message.acceptedVersion}`
                    : message.state === "dismissed"
                      ? "Suggestion dismissed"
                      : "Review trip change"}
                </strong>
                <p>{message.proposal.summary}</p>
                {message.edits && (
                  <ul>
                    {message.edits.map((edit) => (
                      <li key={edit}>{edit}</li>
                    ))}
                  </ul>
                )}
                {!message.state && (
                  <>
                    <small>
                      {trip?.id !== message.proposal.tripId ||
                      trip?.version !== message.proposal.baseVersion
                        ? "This suggestion is out of date. Ask again against the latest plan."
                        : `Based on draft v${message.proposal.baseVersion}. Nothing changes until you apply.`}
                    </small>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
                      <button
                        type="button"
                        className="button button-primary"
                        disabled={
                          !onCommand ||
                          trip?.id !== message.proposal.tripId ||
                          trip?.version !== message.proposal.baseVersion
                        }
                        onClick={() => applyProposal(message)}
                      >
                        Apply change
                      </button>
                      <button
                        type="button"
                        className="button button-quiet"
                        onClick={() =>
                          setMessages((current) =>
                            current.map((item) =>
                              item.id === message.id ? { ...item, state: "dismissed" } : item,
                            ),
                          )
                        }
                      >
                        Dismiss suggestion
                      </button>
                    </div>
                  </>
                )}
                {proposalErrors[message.proposal.id] && (
                  <p className="inline-error" role="alert">
                    {proposalErrors[message.proposal.id]}
                  </p>
                )}
              </div>
            )}
          </div>
        ))}
        {onPlanTrip && creationRequest && (
          <section className="chat-plan-handoff" aria-label="Plan from this conversation">
            <strong>Turn your idea into a trip</strong>
            <p>
              Next, review cities, dates and travelers. Confirm your favorites for Qloo, then choose
              whether to create the proposed trip.
            </p>
            <button
              type="button"
              className="button button-primary"
              disabled={pending || !available}
              onClick={() => {
                if (creationRequest) {
                  voice.end();
                  setVoiceOpen(false);
                  onPlanTrip(creationRequest);
                }
              }}
            >
              Build this trip
            </button>
          </section>
        )}
        {available && messages.length === 0 && !pending && !initialMessage && !draft.trim() && (
          <section className={guidance.starters} aria-label="Conversation starters">
            <p>Choose a starting point. Edit it before sending.</p>
            {trip ? (
              <>
                {trip.stops[0] && (
                  <button
                    type="button"
                    onClick={() => {
                      const place = trip.places.find((item) => item.id === trip.stops[0]?.placeId);
                      if (place) startWith(`Pin ${place.name}`);
                    }}
                  >
                    Keep my first place <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    startWith(
                      "Help me review this itinerary for a slower pace. Suggest changes for me to review before anything is applied.",
                    )
                  }
                >
                  Make room to wander <ArrowUpRight size={15} aria-hidden="true" />
                </button>
                {onPlanTrip && (
                  <button
                    type="button"
                    onClick={() =>
                      startWith(
                        "Help me plan another trip. Ask me about destinations, dates and travelers before choosing places.",
                      )
                    }
                  >
                    Think about my next trip <ArrowUpRight size={15} aria-hidden="true" />
                  </button>
                )}
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() =>
                    startWith(
                      "I’m thinking about a 3-day trip. Help me decide where to go, then review dates and travelers.",
                    )
                  }
                >
                  Plan a long weekend <ArrowUpRight size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startWith(
                      "Help me compare two destinations for a long weekend. Ask about what I enjoy before suggesting where to go.",
                    )
                  }
                >
                  Find the right destination <ArrowUpRight size={15} aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={() =>
                    startWith(
                      "I’d like a relaxed trip with cafés, art and time outside. Help me settle the destination, dates and who’s coming.",
                    )
                  }
                >
                  A slower kind of trip <ArrowUpRight size={15} aria-hidden="true" />
                </button>
              </>
            )}
          </section>
        )}
        {pending && partialReply && (
          <section
            className="chat-message assistant-message chat-streaming"
            aria-label="Reply in progress"
          >
            {partialReply}
          </section>
        )}
        {pending && !partialReply && (
          <p className="chat-thinking" role="status">
            <span />
            <span />
            <span /> Thinking about your trip
          </p>
        )}
        {replyNotice && <p role="status">{replyNotice}</p>}
        {(error || retryMessage) && (
          <div className="chat-reply-recovery">
            {error && (
              <p className="inline-error" role="alert">
                {error}
              </p>
            )}
            {retryMessage && (
              <button
                type="button"
                className="button button-secondary"
                disabled={pending || !available}
                onClick={() => void submit(retryMessage.text, retryMessage.id)}
              >
                Retry reply
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => {
                setDraft(retryMessage?.text ?? "");
                setError(null);
                setReplyNotice(null);
                setRetryMessage(null);
              }}
            >
              Edit and retry
            </button>
          </div>
        )}
        <div ref={conversationEnd} />
      </div>
      {voiceOpen && (
        <div className="voice-panel">
          <div className="voice-panel-top">
            <strong>Talk it through</strong>
            <button
              className="icon-button"
              type="button"
              aria-label="Close voice panel"
              onClick={() => {
                voice.end();
                setVoiceOpen(false);
              }}
            >
              <X size={16} />
            </button>
          </div>
          <p className="voice-status" role="status">
            <span className={`voice-orb ${voice.status === "speaking" ? "speaking" : ""}`} />
            {voice.status === "off" ? "Ready when you are" : voice.status}
          </p>
          {voice.error && (
            <p className="inline-error" role="alert">
              {voice.error}
            </p>
          )}
          <div className="voice-controls">
            {voice.status === "off" || voice.status === "error" ? (
              <button
                type="button"
                className="button button-primary"
                disabled={!available}
                onClick={() => {
                  if (canRequestRef.current) void voice.start();
                }}
              >
                <Mic size={16} />
                Start voice call
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="icon-button"
                  aria-label={voice.muted ? "Unmute microphone" : "Mute microphone"}
                  onClick={voice.toggleMute}
                >
                  {voice.muted ? <MicOff size={18} /> : <Mic size={18} />}
                </button>
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Interrupt assistant"
                  onClick={voice.interrupt}
                >
                  <Square size={16} />
                </button>
                <button type="button" className="button button-danger" onClick={voice.end}>
                  <PhoneOff size={16} />
                  End
                </button>
              </>
            )}
          </div>
          {voice.transcript.length > 0 && (
            <div className="voice-transcript" role="log" aria-label="Voice transcript">
              {voice.transcript.slice(-4).map((entry) => (
                <p key={entry.id}>
                  <strong>{entry.role === "user" ? "You" : "Tastip"}</strong> {entry.text}
                </p>
              ))}
            </div>
          )}
          <small>
            Voice can suggest visit changes. Review the card and choose Apply change to update your
            trip.
          </small>
        </div>
      )}
      <form className="chat-composer" onSubmit={send}>
        <label className="sr-only" htmlFor="travel-message">
          Message your travel companion
        </label>
        <textarea
          ref={composer}
          id="travel-message"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask Tastip"
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit(draft.trim());
            }
          }}
          rows={2}
          maxLength={4000}
        />
        <div className="composer-footer">
          <button
            type="button"
            className={`voice-button ${voiceOpen ? "active" : ""}`}
            disabled={!available}
            onClick={() => {
              if (!canRequestRef.current) return;
              if (voiceOpen) voice.end();
              setVoiceOpen((current) => !current);
            }}
            aria-expanded={voiceOpen}
          >
            <Headphones size={17} />
            Talk to Tastip
          </button>
          {pending ? (
            <button
              className="send-button"
              type="button"
              aria-label="Stop reply"
              onClick={(event) => {
                // React reuses this element as Submit when pending clears during the click.
                event.preventDefault();
                stopReply();
              }}
            >
              <Square size={16} />
            </button>
          ) : (
            <button
              className="send-button"
              type="submit"
              aria-label="Send message"
              disabled={!available || !draft.trim()}
            >
              <ArrowUp size={18} />
            </button>
          )}
        </div>
      </form>
      <p className="chat-disclosure">
        {onSignIn
          ? "Sign in when you’re ready. Nothing is sent automatically."
          : configured
            ? "AI can make mistakes. Check practical details."
            : "Exact itinerary commands work locally. Open-ended GPT chat and voice need a server key."}
      </p>
    </section>
  );
}
