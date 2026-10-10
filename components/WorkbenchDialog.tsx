"use client";

import { useEffect, useRef, type ReactNode } from "react";

/** Native modal keeps focus inside, makes the page inert, and restores trigger focus. */
export function WorkbenchDialog({ open, titleId, onClose, busy = false, drawer = false, children }: {
  open: boolean; titleId: string; onClose: () => void; busy?: boolean; drawer?: boolean; children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => { dialog.close(); document.body.style.overflow = previousOverflow; };
  }, [open]);

  return <dialog ref={ref} className={`wb-dialog${drawer ? " wb-drawer" : ""}`} aria-labelledby={titleId}
    onKeyDown={event => {
      if (event.key !== "Tab") return;
      const elements = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a[href], button, input, select, textarea, [tabindex]"))
        .filter(element => element.tabIndex >= 0 && !element.matches(":disabled") && element.getClientRects().length > 0);
      const first = elements[0], last = elements.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (!busy && event.target === event.currentTarget) {
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    } }}>
    {children}
  </dialog>;
}
