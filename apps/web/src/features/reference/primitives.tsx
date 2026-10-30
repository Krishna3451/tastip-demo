"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

let modalScrollLocks = 0;
let overflowBeforeModals = "";

export function useSheetDismissal(onClose: () => void) {
  const root = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement;
    root.current?.querySelector<HTMLButtonElement>('button[aria-label^="Close"]')?.focus();
    function handleKey(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.querySelector("dialog[open]")
      ) {
        event.preventDefault();
        close.current();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return root;
}

export function AssistantMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`mt-assistant-mark ${small ? "small" : ""}`} aria-hidden="true">
      <span>✦</span>
      <i>✦</i>
      <b>✦</b>
    </span>
  );
}

export function Modal({
  title,
  children,
  onClose,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.showModal();
    if (modalScrollLocks === 0) overflowBeforeModals = document.body.style.overflow;
    modalScrollLocks++;
    document.body.style.overflow = "hidden";
    return () => {
      modalScrollLocks--;
      if (modalScrollLocks === 0) document.body.style.overflow = overflowBeforeModals;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className={`mt-dialog ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <button
        type="button"
        className="mt-icon mt-dialog-close"
        aria-label="Close"
        onClick={onClose}
      >
        <X size={20} />
      </button>
      {children}
    </dialog>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={`mt-toggle ${checked ? "checked" : ""}`}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="mt-empty">
      <span className="mt-empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{description}</p>
      {action}
    </div>
  );
}
