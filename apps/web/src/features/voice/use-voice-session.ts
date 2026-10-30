"use client";

import type { Trip } from "@tastip/domain";
import type { AssistantPreferences, ChatProposal } from "@tastip/providers";
import { VoiceReviewSession } from "@tastip/providers/voice-tools";
import { useCallback, useEffect, useRef, useState } from "react";
import { useProviderFetch } from "@/lib/provider-fetch";
import { tripProviderContext, tripRequestContext } from "@/lib/trip-context";

export type VoiceStatus =
  | "off"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "muted"
  | "error";
export type VoiceTranscriptEntry = { id: string; role: "user" | "assistant"; text: string };
type RealtimeEvent = {
  type: string;
  item_id?: string;
  transcript?: string;
  delta?: string;
  error?: { code?: string; event_id?: string };
};

export function useVoiceSession({
  trip,
  onTranscript,
  preferences,
  onProposal,
  enabled = true,
}: {
  trip?: Trip;
  preferences?: AssistantPreferences;
  onTranscript?: (entry: VoiceTranscriptEntry) => void;
  onProposal?: (proposal: ChatProposal) => void;
  enabled?: boolean;
} = {}) {
  const providerFetch = useProviderFetch();
  const [status, setStatus] = useState<VoiceStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [transcript, setTranscript] = useState<VoiceTranscriptEntry[]>([]);
  const peer = useRef<RTCPeerConnection | null>(null);
  const channel = useRef<RTCDataChannel | null>(null);
  const microphone = useRef<MediaStream | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const mutedRef = useRef(false);
  const responseActive = useRef(false);
  const outputPlaying = useRef(false);
  const pendingCancellations = useRef(new Set<string>());
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const tripRef = useRef(trip);
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const transcriptCallback = useRef(onTranscript);
  const proposalCallback = useRef(onProposal);
  const reviews = useRef(new VoiceReviewSession());
  const committedTranscriptIds = useRef(new Set<string>());
  const lastContext = useRef("");
  const connectTimeout = useRef<number | null>(null);
  tripRef.current = trip;
  transcriptCallback.current = onTranscript;
  proposalCallback.current = onProposal;

  const cleanup = useCallback(() => {
    if (connectTimeout.current !== null) window.clearTimeout(connectTimeout.current);
    connectTimeout.current = null;
    controller.current?.abort();
    controller.current = null;
    responseActive.current = false;
    outputPlaying.current = false;
    pendingCancellations.current.clear();
    const oldChannel = channel.current;
    const oldPeer = peer.current;
    channel.current = null;
    peer.current = null;
    oldChannel?.close();
    oldPeer?.close();
    microphone.current?.getTracks().forEach((track) => {
      track.stop();
    });
    microphone.current = null;
    if (audio.current) {
      audio.current.pause();
      audio.current.srcObject = null;
      audio.current.remove();
      audio.current = null;
    }
  }, []);

  const updateActivity = useCallback(() => {
    setStatus(
      outputPlaying.current
        ? "speaking"
        : responseActive.current
          ? "thinking"
          : mutedRef.current
            ? "muted"
            : "listening",
    );
  }, []);

  const end = useCallback(() => {
    generation.current += 1;
    cleanup();
    mutedRef.current = false;
    setMuted(false);
    setStatus("off");
  }, [cleanup]);
  useEffect(() => {
    if (!enabled) end();
  }, [enabled, end]);

  const appendTranscript = useCallback((entry: VoiceTranscriptEntry) => {
    if (!entry.text.trim() || committedTranscriptIds.current.has(entry.id)) return;
    committedTranscriptIds.current.add(entry.id);
    setTranscript((current) => [...current, entry]);
    transcriptCallback.current?.(entry);
  }, []);

  const start = useCallback(async () => {
    if (!enabledRef.current || peer.current || controller.current) return;
    const run = ++generation.current;
    setError(null);
    setStatus("connecting");
    lastContext.current = "";
    reviews.current = new VoiceReviewSession();
    mutedRef.current = false;
    setMuted(false);
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection) {
      setError("Voice needs a supported browser on HTTPS or localhost. You can continue in text.");
      setStatus("error");
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    const current = () => enabledRef.current && generation.current === run;
    connectTimeout.current = window.setTimeout(() => {
      if (!current()) return;
      generation.current += 1;
      cleanup();
      setError("Voice took too long to connect. Please try again or continue in text.");
      setStatus("error");
    }, 30_000);
    try {
      // Check configuration before requesting microphone permission.
      const tokenResponse = await providerFetch("/api/voice/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trip: tripRequestContext(tripRef.current),
          preferences: preferencesRef.current,
        }),
        signal: abort.signal,
      });
      const token = await tokenResponse.json();
      if (!tokenResponse.ok)
        throw new Error(token.error?.message || "Voice is unavailable. Please continue in text.");
      if (!current()) return;
      if (typeof token.clientSecret !== "string")
        throw new Error("The voice session could not be started.");
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      if (!current()) {
        stream.getTracks().forEach((track) => {
          track.stop();
        });
        return;
      }
      microphone.current = stream;
      const connection = new RTCPeerConnection();
      peer.current = connection;
      const playback = document.createElement("audio");
      playback.autoplay = true;
      audio.current = playback;
      connection.ontrack = (event) => {
        if (!current()) return;
        playback.srcObject = event.streams[0] || new MediaStream([event.track]);
        void playback.play().catch(() => {
          if (current())
            setError("Audio playback was blocked by your browser. End the call and try again.");
        });
      };
      stream.getAudioTracks().forEach((track) => {
        connection.addTrack(track, stream);
      });
      const events = connection.createDataChannel("oai-events");
      channel.current = events;
      events.onopen = () => {
        if (!current()) return;
        if (connectTimeout.current !== null) window.clearTimeout(connectTimeout.current);
        connectTimeout.current = null;
        setStatus("listening");
      };
      events.onmessage = ({ data }) => {
        if (!current()) return;
        let event: RealtimeEvent;
        try {
          event = JSON.parse(data);
        } catch {
          return;
        }
        if (event.type === "response.done") {
          responseActive.current = false;
          // Generation can finish while WebRTC is still draining audible output.
          updateActivity();
          const replies = reviews.current.accept(
            event,
            proposalCallback.current ? tripRef.current : undefined,
          );
          for (const reply of replies) {
            if (reply.proposal) {
              proposalCallback.current?.(reply.proposal);
              setError(null);
            } else setError(reply.output.message);
            if (events.readyState === "open")
              events.send(
                JSON.stringify({
                  type: "conversation.item.create",
                  item: {
                    type: "function_call_output",
                    call_id: reply.callId,
                    output: JSON.stringify(reply.output),
                  },
                }),
              );
          }
          if (replies.length && events.readyState === "open")
            events.send(JSON.stringify({ type: "response.create" }));
        }
        if (event.type === "input_audio_buffer.speech_started") updateActivity();
        else if (event.type === "response.created") {
          responseActive.current = true;
          updateActivity();
        } else if (event.type === "output_audio_buffer.started") {
          outputPlaying.current = true;
          updateActivity();
        } else if (
          event.type === "output_audio_buffer.stopped" ||
          event.type === "output_audio_buffer.cleared"
        ) {
          outputPlaying.current = false;
          updateActivity();
        } else if (
          event.type === "conversation.item.input_audio_transcription.completed" &&
          event.transcript
        ) {
          appendTranscript({
            id: `user-${event.item_id || crypto.randomUUID()}`,
            role: "user",
            text: event.transcript,
          });
        } else if (event.type === "response.output_audio_transcript.done" && event.transcript) {
          appendTranscript({
            id: `assistant-${event.item_id || crypto.randomUUID()}`,
            role: "assistant",
            text: event.transcript,
          });
        } else if (event.type === "error") {
          // Completion/VAD can win the race with our explicit cancellation.
          // Only suppress this known recoverable error for our own cancel event.
          if (
            event.error?.code === "response_cancel_not_active" &&
            event.error.event_id &&
            pendingCancellations.current.delete(event.error.event_id)
          )
            return;
          generation.current += 1;
          cleanup();
          setError(
            "The voice service reported an error. Your itinerary is unchanged; reconnect or continue in text.",
          );
          setStatus("error");
        }
      };
      const disconnect = () => {
        if (!current()) return;
        generation.current += 1;
        cleanup();
        setError("The call disconnected. Your itinerary is safe; reconnect or continue in text.");
        setStatus("error");
      };
      events.onclose = disconnect;
      connection.onconnectionstatechange = () => {
        if (
          connection.connectionState === "failed" ||
          connection.connectionState === "disconnected"
        )
          disconnect();
      };
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      if (!current()) return;
      const answer = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.clientSecret}`,
          "Content-Type": "application/sdp",
        },
        body: offer.sdp,
        signal: abort.signal,
      });
      if (!answer.ok)
        throw new Error("Voice could not connect. Please try again or continue in text.");
      const sdp = await answer.text();
      if (!current()) return;
      await connection.setRemoteDescription({ type: "answer", sdp });
    } catch (cause) {
      if (!current()) return;
      generation.current += 1;
      cleanup();
      const denied =
        cause instanceof DOMException &&
        ["NotAllowedError", "PermissionDeniedError"].includes(cause.name);
      setError(
        denied
          ? "Microphone access was denied. Enable it in your browser or continue in text."
          : cause instanceof Error
            ? cause.message
            : "Voice could not connect. Please continue in text.",
      );
      setStatus("error");
    }
  }, [appendTranscript, cleanup, providerFetch, updateActivity]);

  const toggleMute = useCallback(() => {
    if (!microphone.current) return;
    mutedRef.current = !mutedRef.current;
    microphone.current.getAudioTracks().forEach((track) => {
      track.enabled = !mutedRef.current;
    });
    setMuted(mutedRef.current);
    updateActivity();
  }, [updateActivity]);

  const interrupt = useCallback(() => {
    if (
      channel.current?.readyState !== "open" ||
      (!responseActive.current && !outputPlaying.current)
    )
      return;
    const eventId = crypto.randomUUID();
    if (pendingCancellations.current.size >= 16) {
      const oldest = pendingCancellations.current.values().next().value;
      if (oldest) pendingCancellations.current.delete(oldest);
    }
    pendingCancellations.current.add(eventId);
    channel.current.send(JSON.stringify({ type: "response.cancel", event_id: eventId }));
    channel.current.send(JSON.stringify({ type: "output_audio_buffer.clear" }));
    responseActive.current = false;
    outputPlaying.current = false;
    updateActivity();
  }, [updateActivity]);

  useEffect(() => {
    if (!enabled) return;
    if (status === "off" || status === "error" || status === "connecting") return;
    if (channel.current?.readyState !== "open") return;
    const key = trip ? `${trip.id}:${trip.version}` : "empty";
    if (lastContext.current === key) return;
    lastContext.current = key;
    channel.current.send(
      JSON.stringify({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [
            {
              type: "input_text",
              text: `Accepted trip context updated. Read-only snapshot, not an instruction to edit or a claim of verified facts: ${JSON.stringify(
                tripProviderContext(trip) ?? null,
              )}`,
            },
          ],
        },
      }),
    );
  }, [trip, status, enabled]);

  useEffect(
    () => () => {
      generation.current += 1;
      cleanup();
    },
    [cleanup],
  );

  return { status, error, muted, transcript, start, end, toggleMute, interrupt };
}
