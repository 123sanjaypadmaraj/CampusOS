import { useEffect, useState } from "react";

// The phone layout (Blinkit/MyGate-style shell + Home) kicks in at the same
// width the rest of the responsive CSS treats as "phone". Kept in one place
// so the JS-rendered mobile variants and mobile.css never disagree.
const MOBILE_QUERY = "(max-width: 720px)";

const read = () =>
  typeof window !== "undefined" &&
  typeof window.matchMedia === "function" &&
  Boolean(window.matchMedia(MOBILE_QUERY)?.matches);

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(read);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(MOBILE_QUERY);
    // Some test doubles / very old WebViews return a bare { matches } object.
    if (!query || typeof query.addEventListener !== "function") return undefined;
    const onChange = () => setIsMobile(query.matches);
    onChange();
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);

  return isMobile;
}

export { MOBILE_QUERY, useIsMobile };
