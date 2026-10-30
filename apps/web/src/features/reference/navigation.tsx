"use client";

import {
  Bell,
  BriefcaseBusiness,
  ChevronLeft,
  ChevronRight,
  Heart,
  House,
  Info,
  LogOut,
  Menu,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Send,
  Settings,
  SlidersHorizontal,
  Sparkles,
  SquareCheck,
  SquarePen,
  SquarePlus,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { Conversation } from "../planner/lib/conversations";
import { AssistantMark, Modal, Toggle } from "./primitives";

const ITEMS = [
  ["Home", "/", House],
  ["For you", "/discover", Sparkles],
  ["Chats", "/chats", MessageCircle],
  ["Trips", "/trips", BriefcaseBusiness],
  ["Agents", "/agents", SquareCheck],
  ["Explore", "/explore", Search],
  ["Saved", "/saved", Heart],
  ["Updates", "/updates", Bell],
  ["Inspiration", "/inspiration", Send],
  ["Create", "/create", SquarePlus],
] as const;

export function Navigation({
  path,
  username,
  chats,
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
  onAccount: () => void;
  onCreate: () => void;
  onNewChat: () => void;
  onRenameChat: (chat: Conversation) => void;
  onArchiveChat: (id: string, archived: boolean) => void;
  onSignOut: () => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [drawer, setDrawer] = useState<"Chats" | "Updates" | null>(null);
  const [accountMenu, setAccountMenu] = useState(false);
  const [companyMenu, setCompanyMenu] = useState(false);
  const [chatMenu, setChatMenu] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [updateTab, setUpdateTab] = useState("All");
  const [unread, setUnread] = useState(false);
  const [updateMenu, setUpdateMenu] = useState(false);
  const nav = useRef<HTMLElement>(null);
  const overlay = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const mobileTrigger = useRef<HTMLButtonElement>(null);
  const isCollapsed = collapsed || Boolean(drawer);
  useEffect(() => {
    try {
      setCollapsed(localStorage.getItem("tastip.reference.rail") === "collapsed");
    } catch {
      /* Optional preference. */
    }
  }, []);
  // Moving between workspace pages closes transient navigation without losing the rail preference.
  // biome-ignore lint/correctness/useExhaustiveDependencies: Path changes intentionally close all transient UI.
  useEffect(() => {
    setDrawer(null);
    setMobileOpen(false);
    setAccountMenu(false);
    setCompanyMenu(false);
    setChatMenu(null);
  }, [path]);
  useEffect(() => {
    if (!drawer && !accountMenu && !companyMenu) return;
    function dismiss(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !(event.target instanceof Element && event.target.closest("dialog")) &&
        !nav.current?.contains(event.target) &&
        !overlay.current?.contains(event.target)
      ) {
        setDrawer(null);
        setAccountMenu(false);
        setCompanyMenu(false);
        setChatMenu(null);
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key !== "Escape" || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      if (chatMenu) setChatMenu(null);
      else {
        setDrawer(null);
        setAccountMenu(false);
        setCompanyMenu(false);
        trigger.current?.focus();
      }
    }
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [drawer, accountMenu, companyMenu, chatMenu]);
  useEffect(() => {
    if (drawer)
      Array.from(overlay.current?.querySelectorAll<HTMLElement>("input, button") ?? [])
        .find((control) => control.getClientRects().length > 0)
        ?.focus();
    if (accountMenu)
      nav.current?.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]')?.focus();
  }, [drawer, accountMenu]);
  useEffect(() => {
    if (!mobileOpen) return;
    const mobile = window.matchMedia("(max-width: 800px)");
    function closeOnDesktop() {
      if (!mobile.matches) setMobileOpen(false);
    }
    closeOnDesktop();
    if (!nav.current?.querySelector('[role="menu"]'))
      nav.current?.querySelector<HTMLButtonElement>('[aria-label="Close navigation"]')?.focus();
    mobile.addEventListener("change", closeOnDesktop);
    return () => mobile.removeEventListener("change", closeOnDesktop);
  }, [mobileOpen]);
  function openDrawer(name: "Chats" | "Updates", element: HTMLElement) {
    trigger.current = mobileOpen ? (mobileTrigger.current ?? element) : element;
    setDrawer(drawer === name ? null : name);
    setAccountMenu(false);
    setCompanyMenu(false);
    setMobileOpen(false);
  }
  function closeMobileNavigation() {
    if (!mobileOpen) return;
    setMobileOpen(false);
    setAccountMenu(false);
    setCompanyMenu(false);
  }
  function newChat() {
    setDrawer(null);
    setMobileOpen(false);
    onNewChat();
  }
  function navItem(title: string, href: string, Icon: (typeof ITEMS)[number][2], mobile = false) {
    const selected = drawer
      ? drawer === title
      : path === href || (href === "/trips" && path.startsWith("/trip/"));
    const content = (
      <>
        <Icon size={mobile ? 21 : 21} strokeWidth={1.7} />
        <span>{mobile && title === "Chats" ? "Chat" : title}</span>
        {title === "Chats" && !mobile && chats.filter((chat) => !chat.archived).length > 0 && (
          <small className="mt-nav-count">{chats.filter((chat) => !chat.archived).length}</small>
        )}
      </>
    );
    return title === "Chats" || title === "Updates" ? (
      <button
        key={href}
        type="button"
        className={selected ? "selected" : ""}
        aria-label={title}
        aria-expanded={drawer === title}
        aria-controls="mt-navigation-panel"
        title={isCollapsed ? title : undefined}
        onClick={(event) => openDrawer(title, event.currentTarget)}
      >
        {content}
      </button>
    ) : (
      <Link
        key={href}
        href={href}
        className={selected ? "selected" : ""}
        aria-label={title}
        aria-current={path === href ? "page" : undefined}
        title={isCollapsed ? title : undefined}
        onClick={() => {
          setDrawer(null);
          setMobileOpen(false);
        }}
      >
        {content}
      </Link>
    );
  }
  const filtered = chats
    .filter(
      (chat) =>
        Boolean(chat.archived) === archived &&
        `${chat.title} ${chat.messages.find((message) => message.role === "user")?.text ?? ""}`
          .toLowerCase()
          .includes(query.toLowerCase()),
    )
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const sidebar = (
    <aside
      ref={nav}
      className={`mt-sidebar ${isCollapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
      aria-label="Main navigation"
    >
      <div className="mt-sidebar-brand">
        <Link onClick={closeMobileNavigation} href="/" className="mt-brand">
          <AssistantMark small />
          <span>tastip.</span>
        </Link>
        <button
          type="button"
          className="mt-icon mt-collapse"
          aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
          onClick={() => {
            const next = drawer ? false : !collapsed;
            setDrawer(null);
            setCollapsed(next);
            try {
              localStorage.setItem("tastip.reference.rail", next ? "collapsed" : "expanded");
            } catch {
              /* Optional preference. */
            }
          }}
        >
          {isCollapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
        </button>
        <button
          type="button"
          className="mt-icon mt-mobile-close"
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
        >
          <X />
        </button>
      </div>
      <nav>{ITEMS.map(([title, href, Icon]) => navItem(title, href, Icon))}</nav>
      <div className="mt-sidebar-bottom">
        <button className="mt-new-chat" type="button" onClick={newChat}>
          <Plus size={17} />
          <span>New chat</span>
        </button>
        <button
          className="mt-profile"
          type="button"
          aria-label={username ? `${username} Menu` : "Guest Menu"}
          aria-haspopup="menu"
          aria-expanded={accountMenu}
          onClick={(event) => {
            trigger.current = event.currentTarget;
            setDrawer(null);
            setCompanyMenu(false);
            setAccountMenu(!accountMenu);
          }}
        >
          <span className="mt-avatar">
            {username?.charAt(0).toUpperCase() ?? <UserRound size={19} />}
          </span>
          <span>
            <strong>{username ?? "Guest"}</strong>
            <small>{username ? `@${username}` : "Sign in to save your trips"}</small>
          </span>
          <span className="mt-profile-dots">···</span>
        </button>
        <div className="mt-legal">
          <Link onClick={closeMobileNavigation} href="/about">
            Company
          </Link>{" "}
          ·{" "}
          <Link onClick={closeMobileNavigation} href="/contact">
            Contact
          </Link>{" "}
          ·{" "}
          <Link onClick={closeMobileNavigation} href="/help">
            Help
          </Link>
          <br />
          <Link onClick={closeMobileNavigation} href="/terms">
            Terms
          </Link>{" "}
          ·{" "}
          <Link onClick={closeMobileNavigation} href="/privacy">
            Privacy
          </Link>
          <p>© 2026 Tastip</p>
        </div>
        {isCollapsed && (
          <button
            className="mt-icon mt-company-trigger"
            aria-label="Company info"
            aria-haspopup="menu"
            aria-expanded={companyMenu}
            type="button"
            onClick={() => {
              setCompanyMenu(!companyMenu);
              setAccountMenu(false);
            }}
          >
            <Info size={16} />
          </button>
        )}
      </div>
      {accountMenu && (
        <div className="mt-account-menu" role="menu" aria-label="Account menu">
          <Link
            onClick={closeMobileNavigation}
            href="/profile"
            role="menuitem"
            className="mt-profile-menu-heading"
          >
            <span className="mt-avatar">
              {username?.charAt(0).toUpperCase() ?? <UserRound size={18} />}
            </span>
            <span>
              <strong>{username ?? "Guest"}</strong>
              <small>View profile</small>
            </span>
          </Link>
          <hr />
          <Link onClick={closeMobileNavigation} role="menuitem" href="/setup">
            <Sparkles size={18} />
            Update my assistant
          </Link>
          <Link onClick={closeMobileNavigation} role="menuitem" href="/settings?section=account">
            <Settings size={18} />
            Settings
          </Link>
          <Link
            onClick={closeMobileNavigation}
            role="menuitem"
            href="/settings?section=personalization"
          >
            <SlidersHorizontal size={18} />
            Personalization
          </Link>
          <Link onClick={closeMobileNavigation} role="menuitem" href="/receipts">
            <BriefcaseBusiness size={18} />
            Receipts
          </Link>
          <hr />
          <Link onClick={closeMobileNavigation} role="menuitem" href="/contact">
            Give feedback
          </Link>
          <Link onClick={closeMobileNavigation} role="menuitem" href="/privacy">
            Privacy policy
          </Link>
          <Link onClick={closeMobileNavigation} role="menuitem" href="/terms">
            Terms of service
          </Link>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setAccountMenu(false);
              username ? onSignOut() : onAccount();
            }}
          >
            <LogOut size={18} />
            {username ? "Log out" : "Sign in"}
          </button>
        </div>
      )}
      {companyMenu && (
        <div className="mt-account-menu mt-company-menu" role="menu" aria-label="Company info">
          {[
            ["Company", "/about"],
            ["Contact", "/contact"],
            ["Help", "/help"],
            ["Terms", "/terms"],
            ["Privacy", "/privacy"],
          ].map(([title, href]) => (
            <Link onClick={closeMobileNavigation} key={href} role="menuitem" href={href!}>
              {title}
            </Link>
          ))}
        </div>
      )}
    </aside>
  );
  return (
    <>
      <header className="mt-mobile-header">
        <button
          ref={mobileTrigger}
          className="mt-icon"
          type="button"
          aria-label="Open navigation"
          onClick={() => setMobileOpen(true)}
        >
          <Menu size={22} />
        </button>
        <Link className="mt-brand" href="/">
          <AssistantMark small />
          tastip.
        </Link>
        <button type="button" className="mt-icon" aria-label="Create a trip" onClick={onCreate}>
          <Plus />
        </button>
      </header>
      {mobileOpen ? (
        <Modal
          title="Main navigation"
          className="mt-mobile-navigation-dialog"
          onClose={() => {
            if (accountMenu || companyMenu) {
              setAccountMenu(false);
              setCompanyMenu(false);
              nav.current
                ?.querySelector<HTMLButtonElement>(
                  companyMenu ? ".mt-company-trigger" : ".mt-profile",
                )
                ?.focus();
            } else setMobileOpen(false);
          }}
        >
          {sidebar}
          <button
            className="mt-nav-backdrop"
            type="button"
            tabIndex={-1}
            aria-label="Close navigation backdrop"
            onClick={() => setMobileOpen(false)}
          />
        </Modal>
      ) : (
        sidebar
      )}
      {drawer && (
        <section
          ref={overlay}
          id="mt-navigation-panel"
          className="mt-navigation-panel"
          aria-label={drawer}
        >
          <button
            type="button"
            className="mt-icon mt-panel-close"
            aria-label={`Close ${drawer}`}
            onClick={() => {
              setDrawer(null);
              trigger.current?.focus();
            }}
          >
            <X size={18} />
          </button>
          {drawer === "Chats" ? (
            <>
              <label className="mt-nav-search">
                <Search size={17} />
                <input
                  aria-label="Search chats"
                  placeholder="Search…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
              </label>
              <div className="mt-chat-shortcuts">
                <button type="button" onClick={newChat}>
                  <SquarePen size={20} />
                  New chat
                </button>
                <Link href="/setup">
                  <Sparkles size={20} />
                  Update my assistant
                </Link>
                <Link href="/settings?section=personalization">
                  <Settings size={20} />
                  Personalization
                </Link>
              </div>
              <div className="mt-chat-list-heading">
                <h3>{archived ? "Archived chats" : "Chats"}</h3>
                <button
                  type="button"
                  className="mt-text-action"
                  onClick={() => {
                    setArchived(!archived);
                    setChatMenu(null);
                  }}
                >
                  {archived ? "Back" : "Archived"}
                </button>
              </div>
              <div className="mt-drawer-chat-list">
                {filtered.map((chat) => (
                  <div
                    key={chat.id}
                    className={`mt-drawer-chat ${path === `/chat/${chat.id}` ? "selected" : ""}`}
                  >
                    <Link href={`/chat/${chat.id}`} onClick={() => setDrawer(null)}>
                      <strong>{chat.title}</strong>
                      {chat.tripId && <small>Trip conversation</small>}
                    </Link>
                    <button
                      className="mt-icon"
                      type="button"
                      aria-label={`Options for ${chat.title}`}
                      aria-expanded={chatMenu === chat.id}
                      onClick={() => setChatMenu(chatMenu === chat.id ? null : chat.id)}
                    >
                      <MoreHorizontal size={18} />
                    </button>
                    {chatMenu === chat.id && (
                      <div className="mt-chat-options" role="menu" aria-label="Chat options">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setChatMenu(null);
                            onRenameChat(chat);
                          }}
                        >
                          <Pencil size={15} />
                          Rename
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            onArchiveChat(chat.id, !chat.archived);
                            setChatMenu(null);
                          }}
                        >
                          {chat.archived ? "Restore chat" : "Archive chat"}
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {filtered.length === 0 && (
                  <p className="mt-muted mt-chat-no-results">
                    {query
                      ? "No chats found."
                      : archived
                        ? "No archived chats."
                        : "Your conversations will appear here."}
                  </p>
                )}
              </div>
            </>
          ) : (
            <>
              <header className="mt-updates-heading">
                <h2>
                  Updates <small>0</small>
                </h2>
                <div className="mt-unread-control">
                  Unreads
                  <Toggle label="Unreads" checked={unread} onChange={setUnread} />
                </div>
                <button
                  type="button"
                  className="mt-icon"
                  aria-label="More update options"
                  aria-expanded={updateMenu}
                  onClick={() => setUpdateMenu(!updateMenu)}
                >
                  <MoreHorizontal size={18} />
                </button>
              </header>
              {updateMenu && (
                <div className="mt-update-options" role="menu">
                  <Link role="menuitem" href="/settings?section=notifications">
                    Notification settings
                  </Link>
                  <button role="menuitem" type="button" onClick={() => setUpdateMenu(false)}>
                    Mark all as read
                  </button>
                </div>
              )}
              <div className="mt-tabs" role="tablist" aria-label="Updates">
                {["All", "@mentions", "Actions"].map((tab) => (
                  <button
                    role="tab"
                    aria-selected={updateTab === tab}
                    type="button"
                    key={tab}
                    onClick={() => setUpdateTab(tab)}
                  >
                    {tab}
                  </button>
                ))}
              </div>
              <div role="tabpanel" aria-label={updateTab} className="mt-updates-empty">
                <span className="mt-updates-art" aria-hidden="true">
                  <Bell size={46} />
                  <i />
                  <i />
                </span>
                <h2>No updates yet. Let’s fix that.</h2>
                <p>You’ll get alerts when you invite someone to your trip or follow a Creator.</p>
                <button
                  type="button"
                  className="mt-primary"
                  onClick={() => {
                    setDrawer(null);
                    onCreate();
                  }}
                >
                  Create a trip
                </button>
              </div>
            </>
          )}
        </section>
      )}
      <nav className="mt-bottom-nav" aria-label="Mobile navigation">
        {ITEMS.filter(([title]) =>
          ["Home", "Chats", "Trips", "Agents", "Explore"].includes(title),
        ).map(([title, href, Icon]) => navItem(title, href, Icon, true))}
        <button
          type="button"
          onClick={() => {
            setMobileOpen(true);
            setAccountMenu(true);
          }}
        >
          <UserRound size={21} />
          <span>You</span>
        </button>
      </nav>
    </>
  );
}
