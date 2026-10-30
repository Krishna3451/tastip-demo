"use client";

import { Bell, CalendarDays, ChevronRight, Globe, Link2, UserRound } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import type { TravelProfile } from "./onboarding";
import { EmptyState, Modal, Toggle } from "./primitives";
import type { WorkspaceSettings } from "./use-settings";

const SECTIONS = [
  ["account", "Account"],
  ["personalization", "Personalization"],
  ["price-alerts", "Price alerts"],
  ["language-region", "Language & region"],
  ["notifications", "Notifications"],
  ["connected-accounts", "Connected accounts"],
  ["cookie-preferences", "Cookie preferences"],
] as const;
const NOTIFICATIONS = [
  [
    "Collaboration updates",
    "Get notified about updates from your co-travelers.",
    [
      "User joined your trip",
      "Somebody mentioned you",
      "User commented on an item in your trip",
      "You joined a trip",
      "New group message",
      "Received Collection Invitation",
      "Collection Collaborator Joined",
      "Joined New Collection",
      "Collection Collaborator Added a Place",
      "Collection Collaborator Added a Note",
      "Collection Visibility Changed",
    ],
  ],
  [
    "Community updates",
    "Stay up to date on the latest news from people you follow and the travel community.",
    [
      "Guide planned",
      "Guide saved",
      "Guide published",
      "New follower",
      "Rec booked",
      "Review published",
      "Guide place closed",
    ],
  ],
  [
    "Share to Tastip",
    "Know the moment your shared content lands in Tastip.",
    ["All Google Pins notifications", "All receipt notifications"],
  ],
  [
    "Travel updates",
    "Get notified about your booked experiences for your trips.",
    [
      "Flight booking updates",
      "Trip disruption updates",
      "Flight delays",
      "Hotel price alerts",
      "Flight price alerts",
    ],
  ],
  [
    "Data processing",
    "Know when Tastip finishes longer-running imports and analysis.",
    ["Calendar upload complete"],
  ],
  ["Chat updates", "Get notified about replies from Tastip in your chats.", ["Tastip replied"]],
  [
    "Agent updates",
    "Hear from the agents you set up to keep watch for you.",
    ["Agent found something"],
  ],
] as const;
const CURRENCIES = {
  INR: "INR (₹) — Indian Rupee",
  USD: "USD ($) — US Dollar",
  GBP: "GBP (£) — British Pound",
  EUR: "EUR (€) — Euro",
  AUD: "AUD ($) — Australian Dollar",
  CAD: "CAD ($) — Canadian Dollar",
  JPY: "JPY (¥) — Japanese Yen",
};

function Row({
  label,
  children,
  action = "Change",
  onClick,
}: {
  label: string;
  children: ReactNode;
  action?: string;
  onClick?: () => void;
}) {
  return (
    <div className="mt-setting-row">
      <div>
        <strong>{label}</strong>
        <div>{children}</div>
      </div>
      {onClick && (
        <button
          type="button"
          className="mt-setting-change"
          aria-label={`${action} ${label}`}
          onClick={onClick}
        >
          {action}
        </button>
      )}
    </div>
  );
}
export function SettingsWorkspace({
  username,
  profile,
  settings,
  error,
  onUpdate,
  onAccount,
  onNotice,
  chatBackup,
}: {
  username?: string;
  profile: TravelProfile | null;
  settings: WorkspaceSettings;
  error: string | null;
  onUpdate: (patch: Partial<WorkspaceSettings>) => boolean;
  onAccount: () => void;
  onNotice: (message: string) => void;
  chatBackup?: ReactNode;
}) {
  const params = useSearchParams();
  const section = SECTIONS.find(([id]) => id === params.get("section"))?.[0] ?? "account";
  const [edit, setEdit] = useState<"region" | "currency" | "units" | "timeZone" | null>(null);
  const [choice, setChoice] = useState("");
  const [notification, setNotification] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const sectionNavigation = useRef<HTMLElement>(null);
  useEffect(() => {
    function revealSection() {
      const navigation = sectionNavigation.current;
      const selected = navigation?.querySelector<HTMLElement>(
        `[href="/settings?section=${section}"]`,
      );
      if (!navigation || !selected || navigation.scrollWidth <= navigation.clientWidth) return;
      const frame = navigation.getBoundingClientRect();
      const item = selected.getBoundingClientRect();
      const distance =
        item.left < frame.left
          ? item.left - frame.left - 4
          : item.right > frame.right
            ? item.right - frame.right + 4
            : 0;
      if (distance)
        navigation.scrollBy({
          left: distance,
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
            ? "instant"
            : "smooth",
        });
    }
    revealSection();
    window.addEventListener("resize", revealSection);
    return () => window.removeEventListener("resize", revealSection);
  }, [section]);
  function update(patch: Partial<WorkspaceSettings>) {
    if (onUpdate(patch)) onNotice("Preferences saved on this device.");
  }
  function openEdit(key: NonNullable<typeof edit>) {
    setChoice(settings[key]);
    setEdit(key);
  }
  function notificationValue(name: string) {
    return settings.notifications[name] ?? { email: false, push: false };
  }
  const preferenceGroups = profile
    ? ([
        [
          "Food",
          [
            profile.dietary.length && `🥗 Dietary: ${profile.dietary.join(", ")}`,
            profile.restaurants.length && `🍷 Dining style: ${profile.restaurants.join(", ")}`,
          ],
        ],
        [
          "Identity",
          [
            profile.city && `🏠 Home base: ${profile.city.name}, ${profile.city.country}`,
            profile.firstName && `👤 Name: ${profile.firstName}`,
          ],
        ],
        [
          "Travel party",
          [profile.companions.length && `👥 Travel party: ${profile.companions.join(", ")}`],
        ],
        ["Accommodation", [profile.lodging.length && `🏨 Type: ${profile.lodging.join(", ")}`]],
        [
          "Budget",
          [
            profile.budget.length &&
              `🧠 Budget philosophy: ${profile.budget.join(", ")}${profile.splurges.length ? `. Sometimes splurges on: ${profile.splurges.join(", ")}` : ""}`,
          ],
        ],
      ] as const)
    : [];
  return (
    <div className="mt-settings-layout">
      <nav ref={sectionNavigation} aria-label="Settings sections">
        {SECTIONS.map(([id, title]) => (
          <Link
            key={id}
            href={`/settings?section=${id}`}
            aria-current={section === id ? "page" : undefined}
          >
            {title}
          </Link>
        ))}
      </nav>
      <section
        className="mt-settings-content"
        aria-label={SECTIONS.find(([id]) => id === section)?.[1]}
      >
        {error && (
          <p role="alert" className="mt-inline-error">
            {error}
          </p>
        )}
        <h1>
          {section === "account" ? "Your account" : SECTIONS.find(([id]) => id === section)?.[1]}
        </h1>
        {section === "account" && (
          <>
            <Row label="Username" action={username ? "Manage" : "Sign in"} onClick={onAccount}>
              {username ? `@${username}` : "Sign in to sync your trips"}
            </Row>
            <Row
              label="Address"
              action="Add"
              onClick={() =>
                setInfo("Address and phone details are not collected by this version of Tastip.")
              }
            >
              Add your full address
            </Row>
            <Row
              label="Phone"
              action="Add phone"
              onClick={() =>
                setInfo("Phone notifications and profile verification are not connected.")
              }
            >
              Add mobile phone number for notifications and profile verification
            </Row>
            <Row
              label="Birthday"
              action="Add"
              onClick={() =>
                setInfo("Birthday details are not collected by this version of Tastip.")
              }
            >
              Enter your birthday
            </Row>
            <Row label="Time zone" onClick={() => openEdit("timeZone")}>
              {settings.timeZone.replaceAll("_", " ")}
            </Row>
            <Row
              label="Marketing email"
              onClick={() => setInfo("Tastip does not send marketing email.")}
            >
              Not subscribed
            </Row>
            <Row
              label="Theme"
              onClick={() => setInfo("The current workspace uses the dark theme.")}
            >
              Dark
            </Row>
            <hr />
            {chatBackup}
            <h2>Receipt forwarding emails</h2>
            <p>
              Add email addresses you forward receipts from. Receipts sent from these addresses will
              be linked to your account.
            </p>
            <div className="mt-settings-email">
              <input
                type="email"
                placeholder="email@example.com"
                aria-label="Receipt forwarding email"
                disabled
              />
              <button
                type="button"
                className="mt-pill"
                onClick={() =>
                  setInfo(
                    "Email receipt forwarding is not connected. You can keep receipt files with a trip when file uploads become available.",
                  )
                }
              >
                Add
              </button>
            </div>
            <p className="mt-settings-caption">Receipt forwarding is not connected.</p>
          </>
        )}
        {section === "personalization" && (
          <>
            <fieldset className="mt-settings-voices">
              <legend>Voice</legend>
              <p>Choose the voice Tastip speaks with in voice chat</p>
              <div>
                {(["marin", "shimmer", "echo", "cedar"] as const).map((voice) => (
                  <label
                    key={voice}
                    className={settings.assistant.voice === voice ? "selected" : ""}
                  >
                    <input
                      type="radio"
                      name="assistant-voice"
                      value={voice}
                      checked={settings.assistant.voice === voice}
                      onChange={() => update({ assistant: { ...settings.assistant, voice } })}
                    />
                    <span className={`mt-voice-color ${voice}`} />
                    <strong>{voice.charAt(0).toUpperCase() + voice.slice(1)}</strong>
                  </label>
                ))}
              </div>
            </fieldset>
            <hr />
            <h2>Communication style</h2>
            <p>Choose how you would like Tastip to communicate with you</p>
            <select
              className="mt-settings-select"
              aria-label="Communication style"
              value={settings.assistant.style}
              onChange={(event) =>
                update({
                  assistant: {
                    ...settings.assistant,
                    style: event.target.value as WorkspaceSettings["assistant"]["style"],
                  },
                })
              }
            >
              {["neutral", "concise", "friendly", "detailed"].map((style) => (
                <option key={style} value={style}>
                  {style.charAt(0).toUpperCase() + style.slice(1)}
                </option>
              ))}
            </select>
            <hr />
            <div className="mt-setting-toggle-row">
              <div>
                <h2>Long-term memory</h2>
                <p>
                  Use your saved travel preferences to personalize future conversations. When off,
                  your saved preferences won’t be sent with new conversations.
                </p>
              </div>
              <Toggle
                label="Long-term memory"
                checked={settings.assistant.memory}
                onChange={(memory) => update({ assistant: { ...settings.assistant, memory } })}
              />
            </div>
            {settings.assistant.memory &&
              preferenceGroups.map(
                ([title, values]) =>
                  values.some(Boolean) && (
                    <div className="mt-memory-group" key={title}>
                      <h2>{title}</h2>
                      {values.map(
                        (value) =>
                          value && (
                            <Link key={String(value)} href="/setup">
                              {value}
                              <ChevronRight size={16} />
                            </Link>
                          ),
                      )}
                    </div>
                  ),
              )}
            {!profile && (
              <Link href="/setup" className="mt-pill outlined">
                Set up your travel preferences
              </Link>
            )}
          </>
        )}
        {section === "language-region" && (
          <>
            <Row
              label="Language"
              onClick={() => setInfo("The current workspace is available in English.")}
            >
              English
            </Row>
            <Row label="Region" onClick={() => openEdit("region")}>
              {settings.region}
            </Row>
            <hr />
            <h2>Advanced</h2>
            <Row label="Currency" onClick={() => openEdit("currency")}>
              {CURRENCIES[settings.currency]}
            </Row>
            <Row label="Units" onClick={() => openEdit("units")}>
              {settings.units === "metric" ? "Metric (°C, km)" : "Imperial (°F, mi)"}
            </Row>
          </>
        )}
        {section === "notifications" && (
          <>
            <p className="mt-settings-caption">
              These choices are saved on this device. Email and push delivery are not connected.
            </p>
            {NOTIFICATIONS.map(([title, description, names]) => (
              <div className="mt-notification-group" key={title}>
                <div className="mt-setting-toggle-row">
                  <div>
                    <h2>{title}</h2>
                    <p>{description}</p>
                  </div>
                  <Toggle
                    label={title}
                    checked={names.some(
                      (name) => notificationValue(name).email || notificationValue(name).push,
                    )}
                    onChange={(enabled) =>
                      update({
                        notifications: {
                          ...settings.notifications,
                          ...Object.fromEntries(
                            names.map((name) => [name, { email: enabled, push: enabled }]),
                          ),
                        },
                      })
                    }
                  />
                </div>
                {names.map((name) => {
                  const value = notificationValue(name);
                  return (
                    <button key={name} type="button" onClick={() => setNotification(name)}>
                      <span>{name}</span>
                      <small>
                        {value.email || value.push
                          ? `On: ${[value.email && "Email", value.push && "Push"].filter(Boolean).join(", ")}`
                          : "Off"}
                      </small>
                      <ChevronRight size={16} />
                    </button>
                  );
                })}
              </div>
            ))}
          </>
        )}
        {section === "connected-accounts" && (
          <div className="mt-connected-account">
            <CalendarDays size={26} />
            <div>
              <h2>Google Calendar</h2>
              <p>
                Import past flights, hotels, and reservations so we can learn how you like to
                travel.
              </p>
            </div>
            <button
              type="button"
              className="mt-pill outlined"
              onClick={() =>
                setInfo(
                  "Google Calendar linking is not connected. No calendar access has been requested.",
                )
              }
            >
              Connect
            </button>
          </div>
        )}
        {section === "price-alerts" && (
          <EmptyState
            icon={<Bell size={34} />}
            title="No price alerts"
            description="Price monitoring is not connected. Your agents can be saved as drafts."
            action={
              <Link href="/agents/manage" className="mt-primary">
                Your agents
              </Link>
            }
          />
        )}
        {section === "cookie-preferences" && (
          <>
            <p>Manage optional cookies for this browser. Essential cookies keep you signed in.</p>
            <div className="mt-setting-toggle-row">
              <div>
                <h2>Strictly necessary</h2>
                <p>Required for account sessions and basic site functionality.</p>
              </div>
              <span className="mt-muted">Always active</span>
            </div>
            <hr />
            <div className="mt-setting-toggle-row">
              <div>
                <h2>Analytics</h2>
                <p>
                  Allow optional analytics cookies. No analytics provider is currently connected.
                </p>
              </div>
              <Toggle
                label="Analytics cookies"
                checked={settings.analytics}
                onChange={(analytics) => update({ analytics })}
              />
            </div>
            <hr />
            <div className="mt-setting-toggle-row">
              <div>
                <h2>Marketing</h2>
                <p>
                  Allow optional marketing cookies. No marketing provider is currently connected.
                </p>
              </div>
              <Toggle
                label="Marketing cookies"
                checked={settings.marketing}
                onChange={(marketing) => update({ marketing })}
              />
            </div>
          </>
        )}
      </section>
      {edit && (
        <Modal
          title={`Change ${edit === "timeZone" ? "time zone" : edit}`}
          className="mt-setting-dialog"
          onClose={() => setEdit(null)}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (onUpdate({ [edit]: choice })) {
                setEdit(null);
                onNotice("Preferences saved on this device.");
              }
            }}
          >
            <h2>Change {edit === "timeZone" ? "time zone" : edit}</h2>
            {edit === "timeZone" ? (
              <label>
                Time zone
                <input
                  required
                  value={choice}
                  onChange={(event) => setChoice(event.target.value)}
                  placeholder="Asia/Kolkata"
                  maxLength={80}
                  list="mt-time-zones"
                />
                <datalist id="mt-time-zones">
                  {[
                    "Asia/Kolkata",
                    "Europe/London",
                    "Europe/Paris",
                    "America/New_York",
                    "America/Los_Angeles",
                    "Asia/Tokyo",
                    "Australia/Sydney",
                    "Etc/UTC",
                  ].map((zone) => (
                    <option key={zone} value={zone} />
                  ))}
                </datalist>
                <small>Use an IANA time zone such as Asia/Kolkata.</small>
              </label>
            ) : (
              <select
                aria-label={edit}
                value={choice}
                onChange={(event) => setChoice(event.target.value)}
              >
                {(edit === "region"
                  ? [
                      "India",
                      "United States",
                      "United Kingdom",
                      "Australia",
                      "Canada",
                      "France",
                      "Germany",
                      "Japan",
                      "Portugal",
                    ]
                  : edit === "currency"
                    ? Object.keys(CURRENCIES)
                    : ["metric", "imperial"]
                ).map((value) => (
                  <option key={value} value={value}>
                    {edit === "currency" ? CURRENCIES[value as keyof typeof CURRENCIES] : value}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="mt-primary">
              Save
            </button>
          </form>
        </Modal>
      )}
      {notification && (
        <Modal
          title={notification}
          className="mt-setting-dialog"
          onClose={() => setNotification(null)}
        >
          <h2>{notification}</h2>
          <p>Choose how you’d like to hear about this update.</p>
          {(["email", "push"] as const).map((channel) => (
            <div key={channel} className="mt-setting-toggle-row">
              <span>{channel === "email" ? "Email" : "Push"}</span>
              <Toggle
                label={`${channel} for ${notification}`}
                checked={notificationValue(notification)[channel]}
                onChange={(enabled) =>
                  update({
                    notifications: {
                      ...settings.notifications,
                      [notification]: { ...notificationValue(notification), [channel]: enabled },
                    },
                  })
                }
              />
            </div>
          ))}
          <p className="mt-settings-caption">Delivery is not connected.</p>
          <button type="button" className="mt-primary" onClick={() => setNotification(null)}>
            Done
          </button>
        </Modal>
      )}
      {info && (
        <Modal
          title="About this feature"
          className="mt-setting-dialog"
          onClose={() => setInfo(null)}
        >
          <h2>About this feature</h2>
          <p>{info}</p>
          <button type="button" className="mt-primary" onClick={() => setInfo(null)}>
            Got it
          </button>
        </Modal>
      )}
    </div>
  );
}

export function ProfileWorkspace({
  username,
  profile,
}: {
  username?: string;
  profile: TravelProfile | null;
}) {
  const name =
    [profile?.firstName, profile?.lastName].filter(Boolean).join(" ") || username || "Guest";
  return (
    <div className="mt-profile-page">
      <div className="mt-profile-cover" />
      <div className="mt-profile-details">
        <span className="mt-profile-large-avatar">
          {name.charAt(0).toUpperCase() || <UserRound />}
        </span>
        <Link className="mt-pill outlined" href="/setup">
          Edit profile
        </Link>
        <h1>{name}</h1>
        <p className="mt-muted">@{username ?? "guest"}</p>
        {profile?.city && (
          <p>
            <Globe size={16} />
            {profile.city.name}, {profile.city.country}
          </p>
        )}
        <p className="mt-profile-stats">
          0 followers <span>0 following</span>
        </p>
        <nav className="mt-tabs">
          <Link href="/create">Guides</Link>
          <Link href="/saved">Collections</Link>
        </nav>
        <EmptyState
          icon={<Link2 size={30} />}
          title="Your travel story starts here"
          description="Create a guide or save places to your collections."
          action={
            <Link href="/create" className="mt-primary">
              Create a guide
            </Link>
          }
        />
      </div>
    </div>
  );
}
