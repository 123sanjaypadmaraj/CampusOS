import { useEffect, useState, useCallback } from "react";

const DISMISS_KEY = "campusos-install-dismissed-at";
// Re-offer the install banner this long after a dismissal, rather than
// hiding it forever off one tap -- someone who dismissed it in their first
// session may well want it once they've used CampusOS for a while.
const DISMISS_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

function isStandalone() {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)")?.matches ||
    // iOS Safari's own (non-standard) flag -- display-mode media query
    // support there is inconsistent across versions.
    window.navigator.standalone === true
  );
}

function dismissedRecently() {
  try {
    const at = Number(localStorage.getItem(DISMISS_KEY));
    return Number.isFinite(at) && Date.now() - at < DISMISS_SNOOZE_MS;
  } catch {
    return false;
  }
}

/** Captures the browser's `beforeinstallprompt` event (doc §80 "install
 * prompt") so the app can offer its own install banner instead of relying
 * on the browser's default UI, which most browsers suppress unless the
 * page calls preventDefault() and re-triggers it later. iOS Safari never
 * fires this event at all -- there's no programmatic install prompt there,
 * only the manual "Add to Home Screen" share-sheet action, so `canInstall`
 * stays false on iOS and callers should show manual instructions instead
 * if they want to cover that platform. */
export function useInstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);

  useEffect(() => {
    if (isStandalone()) return;

    const onBeforeInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferredPrompt(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const promptInstall = useCallback(async () => {
    if (!deferredPrompt) return null;
    deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice.catch(() => null);
    setDeferredPrompt(null);
    return choice?.outcome ?? null;
  }, [deferredPrompt]);

  const dismiss = useCallback(() => {
    setDeferredPrompt(null);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* private browsing / storage disabled -- banner just won't re-hide next load */
    }
  }, []);

  return {
    canInstall: !installed && !!deferredPrompt && !dismissedRecently(),
    installed,
    promptInstall,
    dismiss,
  };
}
