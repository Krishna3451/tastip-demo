"use client";

import { DESTINATIONS, type Destination, validDestination } from "@tastip/domain";
import { ArrowLeft, ArrowRight, CalendarDays, Check, Mic, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useVoiceSession } from "../voice/use-voice-session";
import { AssistantMark } from "./primitives";

export type TravelProfile = {
  firstName: string;
  lastName: string;
  city: Destination | null;
  tripIdea: string;
  loyalty: string[];
  destinations: string[];
  visited: string[];
  companions: string[];
  budget: string[];
  splurges: string[];
  lodging: string[];
  restaurants: string[];
  dietary: string[];
  weekends: string[];
  notes: string;
};
const EMPTY: TravelProfile = {
  firstName: "",
  lastName: "",
  city: null,
  tripIdea: "",
  loyalty: [],
  destinations: [],
  visited: [],
  companions: [],
  budget: [],
  splurges: [],
  lodging: [],
  restaurants: [],
  dietary: [],
  weekends: [],
  notes: "",
};
const STAGES = [
  "The basics",
  "Your next trip",
  "Loyalty & points",
  "Set up your way",
  "Travel destinations",
  "Travel style",
  "Accommodation",
  "Food preferences",
  "Wrapping up",
  "You’re all set",
];
const OPTIONS = {
  companions: ["Solo", "Couple", "Family", "Friends"],
  budget: ["On a budget", "Sensibly priced", "Upscale", "Luxury"],
  splurges: ["Stay", "Restaurants", "Experiences", "Other"],
  lodging: [
    "Luxury hotels",
    "Boutique hotels",
    "Bed & breakfasts",
    "Budget-friendly hotels",
    "Hostels",
    "Campgrounds",
    "Eco-lodges",
    "Inns",
    "Resorts",
    "Motels",
    "Short-term rentals",
    "Other",
  ],
  restaurants: [
    "Fine dining & gourmet",
    "Local street food",
    "Cafes/bistros",
    "Ethnic cuisine",
    "Farm-to-table",
    "Fast casual",
    "Pub / tavern food",
    "Bakeries",
    "Coffee shops",
    "Other",
  ],
  dietary: [
    "None",
    "Gluten-free",
    "Dairy-free",
    "Vegetarian",
    "Vegan",
    "Pescatarian",
    "Halal",
    "Kosher",
    "Other",
  ],
  weekends: [
    "Outdoors",
    "Live music",
    "Art & museums",
    "Bars & nightlife",
    "Sports games",
    "Fitness",
    "Shopping",
    "Movies & theater",
    "Comedy shows",
    "Wellness & spa",
    "Other",
  ],
};

export function Onboarding({
  initial,
  onComplete,
}: {
  initial?: TravelProfile | null;
  onComplete: (profile: TravelProfile) => void;
}) {
  const [profile, setProfile] = useState<TravelProfile>(initial ?? EMPTY);
  const [step, setStep] = useState(0);
  const [tripYes, setTripYes] = useState<boolean | null>(null);
  const [loyaltyYes, setLoyaltyYes] = useState<boolean | null>(null);
  const [voiceMode, setVoiceMode] = useState(false);
  const [placeDraft, setPlaceDraft] = useState("");
  const [visitedDraft, setVisitedDraft] = useState("");
  const [cityQuery, setCityQuery] = useState("");
  const [cities, setCities] = useState<Destination[]>(DESTINATIONS);
  const [error, setError] = useState("");
  const voice = useVoiceSession({});
  function select(key: keyof typeof OPTIONS, value: string) {
    setProfile((current) => ({
      ...current,
      [key]:
        key === "budget"
          ? [value]
          : current[key].includes(value)
            ? current[key].filter((item) => item !== value)
            : [...current[key], value],
    }));
  }
  function chips(key: keyof typeof OPTIONS) {
    return (
      <div className="mt-setup-chips">
        {OPTIONS[key].map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={profile[key].includes(value)}
            onClick={() => select(key, value)}
          >
            {profile[key].includes(value) && <Check size={14} />}
            {value}
          </button>
        ))}
      </div>
    );
  }
  async function findCity() {
    setError("");
    try {
      const response = await fetch("/api/destinations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cityQuery }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message ?? "City search is unavailable.");
      setCities(body.results ?? []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "City search is unavailable.");
    }
  }
  const valid =
    step === 0
      ? Boolean(profile.firstName.trim() && profile.city)
      : step === 1
        ? tripYes !== null
        : step === 2
          ? loyaltyYes === false || Boolean(loyaltyYes && profile.loyalty.length)
          : step === 5
            ? Boolean(profile.companions.length && profile.budget.length)
            : step === 6
              ? profile.lodging.length > 0
              : step === 7
                ? profile.restaurants.length > 0 && profile.dietary.length > 0
                : true;
  return (
    <section className="mt-onboarding">
      <Link className="mt-setup-close" href="/home" onClick={() => voice.end()}>
        <X size={21} />
        Close setup
      </Link>
      <div className="mt-setup-body">
        <AssistantMark />
        {voiceMode ? (
          <div className="mt-setup-voice">
            <span className={`mt-voice-orb ${voice.status === "speaking" ? "speaking" : ""}`}>
              <Mic size={46} />
            </span>
            <h1>
              {voice.status === "off"
                ? "Let’s talk travel."
                : voice.status === "error"
                  ? "Let’s try another way."
                  : "I’m listening."}
            </h1>
            <p>{voice.error ?? "A few topics to get to know your travel style."}</p>
            <button
              type="button"
              className="mt-primary"
              onClick={() => void voice.start()}
              disabled={!["off", "error"].includes(voice.status)}
            >
              Start voice chat
            </button>
            <button
              type="button"
              className="mt-pill outlined"
              onClick={() => {
                voice.end();
                setVoiceMode(false);
                setStep(4);
              }}
            >
              Skip voice chat
            </button>
            <div className="mt-voice-transcript">
              {voice.transcript.map((entry) => (
                <p key={entry.id}>{entry.text}</p>
              ))}
            </div>
          </div>
        ) : (
          <>
            {step === 0 && (
              <>
                <h1>
                  First, a little
                  <br />
                  about you.
                </h1>
                <p>Let’s start with the basics.</p>
                <div className="mt-setup-fields">
                  <label>
                    First name
                    <input
                      autoComplete="given-name"
                      value={profile.firstName}
                      maxLength={80}
                      onChange={(event) =>
                        setProfile({ ...profile, firstName: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Last name
                    <input
                      autoComplete="family-name"
                      value={profile.lastName}
                      maxLength={80}
                      onChange={(event) => setProfile({ ...profile, lastName: event.target.value })}
                    />
                  </label>
                  <label>
                    Where do you live?
                    <div className="mt-search">
                      <input
                        value={cityQuery}
                        placeholder={profile.city?.name ?? "Search your city"}
                        onChange={(event) => {
                          setCityQuery(event.target.value);
                          setCities(
                            DESTINATIONS.filter((city) =>
                              city.name.toLowerCase().includes(event.target.value.toLowerCase()),
                            ),
                          );
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void findCity();
                          }
                        }}
                      />
                      <button
                        className="mt-pill"
                        type="button"
                        disabled={cityQuery.length < 2}
                        onClick={() => void findCity()}
                      >
                        Search
                      </button>
                    </div>
                  </label>
                  <div className="mt-setup-chips">
                    {cities.map((city) => (
                      <button
                        key={city.id}
                        type="button"
                        aria-pressed={profile.city?.id === city.id}
                        onClick={() => {
                          setProfile({ ...profile, city });
                          setCityQuery(city.name);
                        }}
                      >
                        {city.name}, {city.country}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            {step === 1 && (
              <>
                <h1>
                  Do you have a trip
                  <br />
                  in mind now?
                </h1>
                <div className="mt-setup-chips">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={tripYes === value}
                      onClick={() => setTripYes(value)}
                    >
                      {value ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
                {tripYes && (
                  <textarea
                    aria-label="Your next trip"
                    placeholder="Tell me about your next trip…"
                    maxLength={2000}
                    value={profile.tripIdea}
                    onChange={(event) => setProfile({ ...profile, tripIdea: event.target.value })}
                  />
                )}
              </>
            )}
            {step === 2 && (
              <>
                <h1>
                  Any loyalty programs
                  <br />
                  or travel points?
                </h1>
                <p>I’ll keep them in mind when we plan.</p>
                <div className="mt-setup-chips">
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      aria-pressed={loyaltyYes === value}
                      onClick={() => setLoyaltyYes(value)}
                    >
                      {value ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
                {loyaltyYes && (
                  <label>
                    Hotels, airlines or credit cards
                    <input
                      placeholder="Add a program name"
                      maxLength={100}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" && event.currentTarget.value.trim()) {
                          setProfile({
                            ...profile,
                            loyalty: [...profile.loyalty, event.currentTarget.value.trim()].slice(
                              0,
                              20,
                            ),
                          });
                          event.currentTarget.value = "";
                        }
                      }}
                    />
                    <small>
                      Press Enter to add a name. Don’t enter membership or payment numbers.
                    </small>
                  </label>
                )}
                {profile.loyalty.length > 0 && <p>{profile.loyalty.join(" · ")}</p>}
              </>
            )}
            {step === 3 && (
              <>
                <h1>
                  Let’s set this up
                  <br />
                  your way.
                </h1>
                <p>A few simple ways to help me get to know you.</p>
                <div className="mt-setup-choices">
                  <button
                    type="button"
                    onClick={() =>
                      setError(
                        "Calendar import is not connected yet. Choose the questionnaire or voice conversation to continue.",
                      )
                    }
                  >
                    <span className="purple">
                      <CalendarDays size={24} />
                    </span>
                    <div>
                      <h2>Connect your calendar</h2>
                      <p>Start with the places you’ve already been.</p>
                    </div>
                    <ChevronRightIcon />
                  </button>
                  <button type="button" onClick={() => setVoiceMode(true)}>
                    <span className="teal">
                      <Mic size={24} />
                    </span>
                    <div>
                      <h2>Have a conversation</h2>
                      <p>Talk through a few topics about your travel style.</p>
                    </div>
                    <ChevronRightIcon />
                  </button>
                  <button type="button" onClick={() => setStep(4)}>
                    <span className="amber">
                      <Check size={24} />
                    </span>
                    <div>
                      <h2>Take a quick questionnaire</h2>
                      <p>A few questions, at your own pace.</p>
                    </div>
                    <ChevronRightIcon />
                  </button>
                </div>
              </>
            )}
            {step === 4 && (
              <>
                <h1>
                  Your world.
                  <br />
                  Past and future.
                </h1>
                <p>Which places would you love to visit?</p>
                <PlaceInput
                  label="Places to visit"
                  value={placeDraft}
                  onChange={setPlaceDraft}
                  items={profile.destinations}
                  onAdd={(value) =>
                    setProfile({
                      ...profile,
                      destinations: [...profile.destinations, value].slice(0, 30),
                    })
                  }
                />
                <p>And where have you loved going?</p>
                <PlaceInput
                  label="Favorite places visited"
                  value={visitedDraft}
                  onChange={setVisitedDraft}
                  items={profile.visited}
                  onAdd={(value) =>
                    setProfile({ ...profile, visited: [...profile.visited, value].slice(0, 30) })
                  }
                />
              </>
            )}
            {step === 5 && (
              <>
                <h1>
                  How do you
                  <br />
                  like to travel?
                </h1>
                <h2>Who do you usually travel with?</h2>
                {chips("companions")}
                <h2>What’s your typical budget?</h2>
                {chips("budget")}
                <h2>What do you like to splurge on?</h2>
                {chips("splurges")}
              </>
            )}
            {step === 6 && (
              <>
                <h1>
                  Where do you
                  <br />
                  like to stay?
                </h1>
                <p>Choose the kinds of places that feel right.</p>
                {chips("lodging")}
              </>
            )}
            {step === 7 && (
              <>
                <h1>Let’s talk food.</h1>
                <h2>Your kind of restaurants</h2>
                {chips("restaurants")}
                <h2>Any dietary preferences?</h2>
                {chips("dietary")}
              </>
            )}
            {step === 8 && (
              <>
                <h1>A few final things.</h1>
                <h2>What does a good weekend look like?</h2>
                {chips("weekends")}
                <label>
                  Anything else I should know?
                  <textarea
                    maxLength={2000}
                    value={profile.notes}
                    onChange={(event) => setProfile({ ...profile, notes: event.target.value })}
                    placeholder="Tell me what matters to you…"
                  />
                </label>
              </>
            )}
            {step === 9 && (
              <>
                <h1>You’re all set.</h1>
                <p>The more we plan together, the better I’ll get to know your travel style.</p>
                <button className="mt-primary" type="button" onClick={() => onComplete(profile)}>
                  Let’s go <ArrowRight size={18} />
                </button>
              </>
            )}
          </>
        )}
        {error && (
          <p className="mt-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <footer className="mt-setup-footer">
        <div className="mt-setup-progress">
          <span style={{ width: `${Math.min(100, (step + 1) * 10)}%` }} />
        </div>
        <div>
          <span>{STAGES[step]}</span>
          <div>
            {step > 0 && (
              <button
                className="mt-pill outlined"
                type="button"
                onClick={() => {
                  if (voiceMode) {
                    voice.end();
                    setVoiceMode(false);
                  } else setStep(step - 1);
                  setError("");
                }}
              >
                <ArrowLeft size={16} />
                Back
              </button>
            )}
            {step < 9 && step !== 3 && !voiceMode && (
              <button
                className="mt-primary"
                type="button"
                disabled={!valid}
                onClick={() => {
                  setStep(step + 1);
                  setError("");
                }}
              >
                {step === 8 ? "Done" : "Next"}
                <ArrowRight size={17} />
              </button>
            )}
          </div>
        </div>
      </footer>
    </section>
  );
}
function ChevronRightIcon() {
  return <ArrowRight size={18} />;
}
function PlaceInput({
  label,
  value,
  onChange,
  items,
  onAdd,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  items: string[];
  onAdd: (value: string) => void;
}) {
  return (
    <div className="mt-setup-places">
      <div className="mt-search">
        <input
          aria-label={label}
          placeholder="Add place"
          value={value}
          maxLength={100}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && value.trim()) {
              event.preventDefault();
              onAdd(value.trim());
              onChange("");
            }
          }}
        />
        <button
          type="button"
          className="mt-pill"
          disabled={!value.trim()}
          onClick={() => {
            onAdd(value.trim());
            onChange("");
          }}
        >
          Add
        </button>
      </div>
      <p>{items.join(" · ")}</p>
    </div>
  );
}

export function parseTravelProfile(value: unknown): TravelProfile | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    ["firstName", "lastName", "tripIdea", "notes"].some(
      (key) => typeof candidate[key] !== "string" || (candidate[key] as string).length > 2000,
    )
  )
    return null;
  if (candidate.city !== null && !validDestination(candidate.city)) return null;
  for (const key of [
    "loyalty",
    "destinations",
    "visited",
    "companions",
    "budget",
    "splurges",
    "lodging",
    "restaurants",
    "dietary",
    "weekends",
  ]) {
    const items = candidate[key];
    if (
      !Array.isArray(items) ||
      items.length > 30 ||
      items.some((item) => typeof item !== "string" || item.length > 200)
    )
      return null;
  }
  const profile = {} as TravelProfile;
  for (const key of Object.keys(EMPTY) as (keyof TravelProfile)[])
    Object.assign(profile, { [key]: candidate[key] });
  return profile;
}
