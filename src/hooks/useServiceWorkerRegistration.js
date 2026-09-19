import { useEffect } from "react";
import { IS_NATIVE } from "../config/platform";

function useServiceWorkerRegistration() {
  useEffect(() => {
      // Inside a Capacitor native shell, skip registering our own sw.js:
      // Web Push -- half of what public/sw.js does -- doesn't work in a
      // native WebView at all (iOS) or reliably (Android), and the native
      // shell now loads production directly over the network (see
      // capacitor.config.ts) rather than a bundled offline build, so there's
      // no separate offline app-shell to protect here either -- registering
      // it there would just be dead weight, so skip it entirely on native.
      if (IS_NATIVE) return;
      if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, []);
}

export { useServiceWorkerRegistration };
