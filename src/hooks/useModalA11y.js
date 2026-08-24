import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

function focusableElements(container) {
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR));
}

/** Makes CampusOS's one recurring modal shape (`.modal-backdrop` wrapping a
 * dialog card -- every screen's local `Modal`/`ModalShell` component shares
 * this exact markup, deliberately mirrored across files, see e.g.
 * VendorDashboard.jsx's "SHARED SHELL" comment) keyboard- and
 * screen-reader-accessible: traps Tab focus inside the dialog, closes on
 * Escape, moves focus in on open, and restores it to whatever triggered the
 * modal once it closes. One hook so every modal gets this once instead of
 * each file re-solving it (or, as before this pass, not solving it at all --
 * none of them trapped focus, so Tab used to leak straight through to
 * whatever was behind the backdrop).
 *
 * Usage: `const dialogRef = useModalA11y(onClose);` then spread
 * `ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1}` onto the
 * dialog card element (not the backdrop). */
export function useModalA11y(onClose) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  // Captured as a useRef initializer (evaluated during render, before the
  // dialog's own DOM -- including any autoFocus'd field inside it -- is
  // committed) rather than inside the effect below. Reading
  // document.activeElement from inside the effect is too late: several
  // modals autoFocus a field of their own (e.g. LoginModal's email input),
  // and that native autofocus lands during commit, before this hook's
  // effect ever runs -- so by the time the effect read activeElement it
  // would already be looking at the dialog's own input, not the button
  // that opened it, and "restore focus on close" would silently no-op.
  const previouslyFocusedRef = useRef(typeof document !== "undefined" ? document.activeElement : null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;

    const [first] = focusableElements(dialog);
    (first || dialog).focus({ preventScroll: true });

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;

      const items = focusableElements(dialog);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      } else if (!dialog.contains(document.activeElement)) {
        // Focus ended up outside the dialog some other way -- pull it back in
        // rather than letting Tab hand control to whatever's behind the backdrop.
        event.preventDefault();
        firstEl.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      const previouslyFocused = previouslyFocusedRef.current;
      if (previouslyFocused instanceof HTMLElement && document.contains(previouslyFocused)) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
    // Deliberately run once per mount, not per onClose identity -- most
    // callers pass a fresh inline arrow function every render, and
    // re-running this would re-steal focus each time. onCloseRef above
    // keeps Escape calling the latest onClose anyway.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return dialogRef;
}
