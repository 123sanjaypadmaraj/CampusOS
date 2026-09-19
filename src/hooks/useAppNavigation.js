import { useEffect } from "react";
import { FEATURES } from "../config/features";
import { PAGE_TITLES, ROUTABLE_KEYS, keyToPath, pathToKey } from "../config/routing";

function useAppNavigation({ active, setActive, setModal }) {
  const go = (key) => {
      setActive(key);
      setModal(null);
      // Keep the address bar in sync with whatever section is actually
      // rendering. Unroutable keys (shouldn't happen -- every call site
      // passes a value renderPage() handles) fall back to "/" rather than
      // writing a dead URL into history.
      const path = keyToPath(ROUTABLE_KEYS.has(key) ? key : "home");
      if (window.location.pathname !== path) {
        window.history.pushState({ key }, "", path);
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    };

  useEffect(() => {
      const onPopState = () => setActive(pathToKey(window.location.pathname));
      window.addEventListener("popstate", onPopState);
      return () => window.removeEventListener("popstate", onPopState);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps -- setActive is a useState setter, stable by React's guarantee

  useEffect(() => {
      const titleKey = active === "food" && !FEATURES.food ? "home" : active;
      document.title = PAGE_TITLES[titleKey]
        ? `${PAGE_TITLES[titleKey]} | Campus OS`
        : "Campus OS | Your Digital Campus";
    }, [active]);

  return { go };
}

export { useAppNavigation };
