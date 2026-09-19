import React, { useEffect, useMemo, useRef, useState } from "react";
import { useModalA11y } from "../../hooks/useModalA11y";
import { SEARCH_ENTITY_DESTINATIONS, SEARCH_ENTITY_LABELS, SEARCH_FILTER_GROUPS, clearRecentSearches, getRecentSearches, getSearchSuggestions, globalSearch, logSearch } from "../../services/searchService";
import { HiBriefcase, HiCalendarDays, HiChatBubbleOvalLeft, HiChevronRight, HiClock, HiFire, HiMagnifyingGlass, HiMagnifyingGlassCircle, HiMapPin, HiMegaphone, HiOutlineBuildingLibrary, HiShoppingBag, HiShoppingCart, HiSparkles, HiUserCircle, HiUserGroup, HiWrenchScrewdriver, HiXMark } from "react-icons/hi2";

const SEARCH_TYPE_ICON = {
  post: <HiChatBubbleOvalLeft />,
  event: <HiCalendarDays />,
  club: <HiUserGroup />,
  listing: <HiShoppingCart />,
  food_item: <HiShoppingBag />,
  service: <HiWrenchScrewdriver />,
  lost_found: <HiMagnifyingGlassCircle />,
  announcement: <HiMegaphone />,
  person: <HiUserCircle />,
  canteen: <HiOutlineBuildingLibrary />,
  store_vendor: <HiOutlineBuildingLibrary />,
  store_item: <HiShoppingBag />,
  opportunity: <HiBriefcase />,
  location: <HiMapPin />,
};

function GlobalSearchOverlay({ onClose, go, setSearch, authUser, openLogin, notify }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeFilters, setActiveFilters] = useState([]); // SEARCH_FILTER_GROUPS keys; [] = all
  const [recent, setRecent] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const inputRef = useRef(null);
  const dialogRef = useModalA11y(onClose);

  useEffect(() => { inputRef.current?.focus(); }, []);

  // Recent searches + trending suggestions power the empty-query state --
  // both are authenticated-only server-side, so a signed-out visitor just
  // sees the plain search box (no recent history to show them anyway).
  useEffect(() => {
    if (!authUser) return;
    getRecentSearches(8).then(setRecent).catch(() => {});
    getSearchSuggestions(6).then(setSuggestions).catch(() => {});
  }, [authUser]);

  const activeTypes = useMemo(() => {
    if (!activeFilters.length) return null;
    const groups = SEARCH_FILTER_GROUPS.filter((g) => activeFilters.includes(g.key));
    return groups.flatMap((g) => g.types);
  }, [activeFilters]);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) { setResults([]); setError(""); return; }

    const handle = setTimeout(async () => {
      try {
        setLoading(true);
        setError("");
        setResults(await globalSearch(q, 8, activeTypes));
      } catch (err) {
        setError(err.message || "Search failed");
      } finally {
        setLoading(false);
      }
    }, 250);

    return () => clearTimeout(handle);
  }, [query, activeTypes]);

  const grouped = useMemo(() => {
    const groups = {};
    for (const r of results) {
      const label = SEARCH_ENTITY_LABELS[r.entity_type] || r.entity_type;
      groups[label] = groups[label] || [];
      groups[label].push(r);
    }
    return groups;
  }, [results]);

  const toggleFilter = (key) => {
    setActiveFilters((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const runSearch = (text) => setQuery(text);

  const openResult = (result) => {
    const dest = SEARCH_ENTITY_DESTINATIONS[result.entity_type];
    if (!dest) return;

    if (result.entity_type === "person") {
      if (!authUser) { openLogin?.(); notify("Sign in to view classmates"); onClose(); return; }
    }

    if (authUser) logSearch(query).catch(() => {});
    if (dest.prefill) setSearch(result.title);
    go(dest.tab);
    onClose();
  };

  const showEmptyState = authUser && query.trim().length < 2 && (recent.length > 0 || suggestions.length > 0);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="login-modal global-search-modal"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Search CampusOS"
        tabIndex={-1}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button className="modal-close" onClick={onClose} aria-label="Close"><HiXMark /></button>
        <span className="section-kicker">SEARCH CAMPUSOS</span>
        <div className="searchbar" style={{ marginTop: 10, marginBottom: 4 }}>
          <HiMagnifyingGlass />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && authUser && query.trim().length >= 2) logSearch(query).catch(() => {}); }}
            placeholder="Search food, vendors, events, clubs, people, marketplace…"
            aria-label="Search CampusOS"
          />
        </div>

        <div className="global-search-filters">
          {SEARCH_FILTER_GROUPS.map((g) => (
            <button
              key={g.key}
              className={activeFilters.includes(g.key) ? "chip active" : "chip"}
              onClick={() => toggleFilter(g.key)}
            >
              {g.label}
            </button>
          ))}
        </div>

        {loading && <p style={{ color: "var(--muted)", fontSize: 12, padding: "10px 2px" }}>Searching…</p>}
        {error && <p style={{ color: "#c23a3a", fontSize: 12, padding: "10px 2px" }}>{error}</p>}
        {!loading && !error && query.trim().length >= 2 && results.length === 0 && (
          <p style={{ color: "var(--muted)", fontSize: 12, padding: "10px 2px" }}>No results for &ldquo;{query}&rdquo;.</p>
        )}

        {showEmptyState && (
          <div className="global-search-suggestions">
            {recent.length > 0 && (
              <div className="global-search-group">
                <div className="global-search-group-head">
                  <small className="global-search-group-label">Recent searches</small>
                  <button
                    className="ghost"
                    onClick={async () => { try { await clearRecentSearches(); setRecent([]); } catch (err) { notify(err.message || "Could not clear recent searches"); } }}
                  >
                    Clear
                  </button>
                </div>
                <div className="global-search-chip-row">
                  {recent.map((r) => (
                    <button key={r.query} className="chip" onClick={() => runSearch(r.query)}>
                      <HiClock /> {r.query}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {suggestions.length > 0 && (
              <div className="global-search-group">
                <small className="global-search-group-label">Trending on campus</small>
                <div className="global-search-chip-row">
                  {suggestions.map((s) => (
                    <button key={s.query} className="chip" onClick={() => runSearch(s.query)}>
                      <HiFire /> {s.query}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <div className="global-search-results">
          {Object.entries(grouped).map(([label, items]) => (
            <div key={label} className="global-search-group">
              <small className="global-search-group-label">{label}</small>
              {items.map((item) => (
                <button key={`${item.entity_type}-${item.entity_id}`} className="global-search-result" onClick={() => openResult(item)}>
                  <span>{SEARCH_TYPE_ICON[item.entity_type] || <HiSparkles />}</span>
                  <div>
                    <b>{item.title}</b>
                    <small>{item.subtitle}</small>
                  </div>
                  <HiChevronRight />
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { GlobalSearchOverlay, SEARCH_TYPE_ICON };
