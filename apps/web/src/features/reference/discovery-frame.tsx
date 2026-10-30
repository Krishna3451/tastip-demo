"use client";

import {
  ArrowLeft,
  Bookmark,
  Compass,
  History,
  MessageCircle,
  MoreHorizontal,
  Plus,
  Search,
  Sparkles,
  UserRound,
} from "lucide-react";
import Link from "next/link";
import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from "react";
import type { Conversation } from "../planner/lib/conversations";
import { Modal } from "./primitives";

const LINKS = [
  ["Explore", "/explore", Compass],
  ["Saved", "/saved", Bookmark],
  ["For you", "/discover", Sparkles],
] as const;

function menuKeys(
  event: ReactKeyboardEvent<HTMLElement>,
  dismiss: () => void,
  trigger: HTMLElement | null,
) {
  if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    dismiss();
    trigger?.focus();
    return;
  }
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
  event.preventDefault();
  const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]'));
  if (!items.length) return;
  const current = items.indexOf(document.activeElement as HTMLElement);
  const next =
    event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : event.key === "ArrowDown"
          ? (current + 1) % items.length
          : (current - 1 + items.length) % items.length;
  items[next]?.focus();
}

/** Navigation reads the owning workspace's state and emits intent; it owns no trip or account data. */
export function DiscoveryFrame({
  path,
  username,
  chats,
  plannerContext,
  onAccount,
  onCreate,
  onNewChat,
  onRenameChat,
  onArchiveChat,
  onSignOut,
}: {
  path: string;
  username?: string;
  chats: Conversation[];
  plannerContext?: { tripId: string; dayId: string };
  onAccount: () => void;
  onCreate: () => void;
  onNewChat: () => void;
  onRenameChat: (chat: Conversation) => void;
  onArchiveChat: (id: string, archived: boolean) => void;
  onSignOut: () => void;
}) {
  const [history, setHistory] = useState(false);
  const [account, setAccount] = useState(false);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [chatMenu, setChatMenu] = useState<string | null>(null);
  const accountRoot = useRef<HTMLDivElement>(null);
  const accountTrigger = useRef<HTMLButtonElement>(null);
  const chatMenuTrigger = useRef<HTMLButtonElement | null>(null);
  const chatMenuRoot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (chatMenu) chatMenuRoot.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [chatMenu]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Route transitions dismiss transient navigation only.
  useEffect(() => {
    setHistory(false);
    setAccount(false);
    setChatMenu(null);
  }, [path]);
  useEffect(() => {
    if (!account) return;
    accountRoot.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !accountRoot.current?.contains(event.target))
        setAccount(false);
    }
    function dismissOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      setAccount(false);
      accountTrigger.current?.focus();
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, [account]);
  const filtered = chats
    .filter(
      (chat) =>
        Boolean(chat.archived) === archived &&
        `${chat.title} ${chat.messages.find((message) => message.role === "user")?.text ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <>
      <header className="discovery-header">
        <Link href="/" className="discovery-brand" aria-label="Tastip home">
          <Compass size={26} strokeWidth={1.6} aria-hidden="true" />
          <span>
            tastip<span>.</span>
          </span>
        </Link>
        <nav className="discovery-navigation" aria-label="Main navigation">
          <button
            type="button"
            aria-label="Chat"
            aria-current={path === "/chat" || path.startsWith("/chat/") ? "page" : undefined}
            aria-expanded={history}
            aria-haspopup="dialog"
            onClick={() => setHistory(true)}
          >
            <MessageCircle size={17} strokeWidth={1.7} aria-hidden="true" />
            <span>Chat</span>
          </button>
          {LINKS.map(([label, href, Icon]) => (
            <Link key={href} href={href} aria-current={path === href ? "page" : undefined}>
              <Icon size={17} strokeWidth={1.7} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="discovery-header-actions">
          <button
            type="button"
            className="discovery-new-trip"
            aria-label="Create a trip"
            onClick={onCreate}
          >
            <Plus size={17} aria-hidden="true" />
            <span>New trip</span>
          </button>
          <div className="discovery-account" ref={accountRoot}>
            <button
              ref={accountTrigger}
              type="button"
              aria-label={username ? `${username} Menu` : "Guest Menu"}
              aria-haspopup="menu"
              aria-expanded={account}
              onClick={() => setAccount(!account)}
            >
              <UserRound size={18} aria-hidden="true" />
              <span>{username ?? "Sign in"}</span>
            </button>
            {account && (
              <div
                className="discovery-account-menu"
                role="menu"
                aria-label="Account menu"
                onKeyDown={(event) =>
                  menuKeys(event, () => setAccount(false), accountTrigger.current)
                }
              >
                <p>{username ? `Your workspace, ${username}` : "Your travel workspace"}</p>
                <Link role="menuitem" href="/trips">
                  Trips
                </Link>
                <Link role="menuitem" href="/profile">
                  View profile
                </Link>
                <Link role="menuitem" href="/settings?section=account">
                  Settings
                </Link>
                <Link role="menuitem" href="/settings?section=personalization">
                  Personalization
                </Link>
                <Link role="menuitem" href="/receipts">
                  Receipts
                </Link>
                <Link role="menuitem" href="/setup">
                  Update my assistant
                </Link>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setAccount(false);
                    username ? onSignOut() : onAccount();
                  }}
                >
                  {username ? "Log out" : "Sign in"}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>
      {path === "/explore" && (
        <section className="discovery-intro" aria-labelledby="discovery-title">
          <div>
            <p className="eyebrow">A LITTLE CURIOSITY GOES A LONG WAY</p>
            <h1 id="discovery-title">Find your kind of places.</h1>
          </div>
          <p>
            Pick a city. Follow your taste.
            <br />
            Keep the places that feel like you.
          </p>
        </section>
      )}
      {history && (
        <Modal title="Chats" className="discovery-history" onClose={() => setHistory(false)}>
          <section aria-label="Chats">
            <header>
              <History size={22} aria-hidden="true" />
              <h2>Your conversations</h2>
            </header>
            <p>Pick up a travel idea where you left it.</p>
            <div className="discovery-history-tools">
              <label>
                <Search size={16} aria-hidden="true" />
                <input
                  aria-label="Search chats"
                  placeholder="Search your conversations"
                  value={query}
                  maxLength={200}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <button
                type="button"
                className="mt-primary"
                onClick={() => {
                  setHistory(false);
                  onNewChat();
                }}
              >
                <Plus size={16} />
                New chat
              </button>
            </div>
            <div className="discovery-history-tabs">
              <button
                type="button"
                aria-pressed={!archived}
                onClick={() => {
                  setArchived(false);
                  setChatMenu(null);
                }}
              >
                {archived && <ArrowLeft size={14} />}
                {archived ? "Back" : "Recent"}
              </button>
              <button
                type="button"
                aria-pressed={archived}
                onClick={() => {
                  setArchived(true);
                  setChatMenu(null);
                }}
              >
                Archived
              </button>
            </div>
            {filtered.length ? (
              <ul className="discovery-chat-list">
                {filtered.map((chat) => (
                  <li key={chat.id}>
                    <Link
                      href={`/chat/${chat.id}${plannerContext && chat.tripId === plannerContext.tripId ? `?${new URLSearchParams({ return: "planner", day: plannerContext.dayId })}` : ""}`}
                      onClick={() => setHistory(false)}
                    >
                      <strong>{chat.title}</strong>
                      <small>
                        {chat.messages.find((message) => message.role === "user")?.text ??
                          "No messages yet"}
                      </small>
                    </Link>
                    <div className="discovery-chat-options">
                      <button
                        type="button"
                        className="mt-icon"
                        aria-label={`Options for ${chat.title}`}
                        aria-expanded={chatMenu === chat.id}
                        aria-haspopup="menu"
                        onClick={(event) => {
                          chatMenuTrigger.current = event.currentTarget;
                          setChatMenu(chatMenu === chat.id ? null : chat.id);
                        }}
                      >
                        <MoreHorizontal size={19} />
                      </button>
                      {chatMenu === chat.id && (
                        <div
                          ref={chatMenuRoot}
                          role="menu"
                          aria-label={`Chat actions for ${chat.title}`}
                          onKeyDown={(event) =>
                            menuKeys(event, () => setChatMenu(null), chatMenuTrigger.current)
                          }
                        >
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setChatMenu(null);
                              onRenameChat(chat);
                            }}
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setChatMenu(null);
                              onArchiveChat(chat.id, !chat.archived);
                            }}
                          >
                            {chat.archived ? "Restore chat" : "Archive chat"}
                          </button>
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="discovery-history-empty">
                {query
                  ? "No conversations match that search."
                  : archived
                    ? "No archived conversations."
                    : "Your next travel idea can start with a chat."}
              </p>
            )}
          </section>
        </Modal>
      )}
    </>
  );
}
