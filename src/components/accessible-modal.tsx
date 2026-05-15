"use client";

/**
 * AccessibleModal — Drop-in replacement for raw modal-overlay + modal patterns.
 *
 * Provides:
 * - role="dialog" + aria-modal="true"
 * - aria-labelledby linked to the h3 via titleId
 * - Escape key to close
 * - Focus trap: auto-focus first focusable element, return focus on close
 * - Body scroll lock while open
 */

import { useEffect, useRef, useCallback } from "react";

interface AccessibleModalProps {
  open: boolean;
  onClose: () => void;
  /** Unique ID for this modal (used for aria-labelledby) */
  titleId: string;
  children: React.ReactNode;
  /** Optional max-width override */
  maxWidth?: number;
}

export function AccessibleModal({ open, onClose, titleId, children, maxWidth }: AccessibleModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const handleEscape = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") onClose();
  }, [onClose]);

  // Focus management & scroll lock
  useEffect(() => {
    if (!open) return;

    // Save the element that had focus before modal opened
    previousFocusRef.current = document.activeElement as HTMLElement;

    // Focus first focusable element in modal
    const timer = setTimeout(() => {
      const focusable = modalRef.current?.querySelector<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      focusable?.focus();
    }, 50);

    // Lock body scroll
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // Escape key handler
    document.addEventListener("keydown", handleEscape);

    return () => {
      clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", handleEscape);

      // Return focus to the element that triggered the modal
      previousFocusRef.current?.focus();
    };
  }, [open, handleEscape]);

  // Focus trap: keep Tab cycling within the modal
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Tab" || !modalRef.current) return;

    const focusableElements = modalRef.current.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (focusableElements.length === 0) return;

    const firstEl = focusableElements[0];
    const lastEl = focusableElements[focusableElements.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      }
    } else {
      if (document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        ref={modalRef}
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        style={maxWidth ? { maxWidth } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
