// Pure helpers for the club Event Manager (participants table, Google Forms /
// CSV import, team splitting, export). No React, no network -- everything the
// UI needs to parse, map, filter, split and export lives here so it can be
// unit-tested directly (see eventParticipants.test.js).

// ---------------------------------------------------------------------------
// CSV / TSV PARSING
// ---------------------------------------------------------------------------

// Google Forms -> "Link to Sheets" -> File > Download > CSV gives RFC-4180
// CSV (quoted cells, embedded newlines and commas in long answers). Copying
// cells out of the Sheet and pasting gives tab-separated text. Excel in some
// locales saves semicolon-separated. Detect whichever one the first line uses.
export function detectDelimiter(text) {
  const firstLine = (text.split(/\r?\n/, 1)[0] || "");
  let best = ",";
  let bestCount = -1;
  for (const d of [",", "\t", ";"]) {
    let count = 0;
    let inQuotes = false;
    for (const ch of firstLine) {
      if (ch === '"') inQuotes = !inQuotes;
      else if (ch === d && !inQuotes) count++;
    }
    if (count > bestCount) { best = d; bestCount = count; }
  }
  return best;
}

export function parseDelimited(input) {
  const text = String(input ?? "").replace(/^\uFEFF/, "");
  if (!text.trim()) return [];
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else inQuotes = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"' && cell === "") {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(cell); cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      rows.push(row); row = [];
    } else {
      cell += ch;
    }
  }
  row.push(cell);
  rows.push(row);

  // Drop rows that are entirely blank (trailing newline, spacer lines).
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

// ---------------------------------------------------------------------------
// COLUMN MAPPING
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  { key: "name", label: "Name" },
  { key: "usn", label: "USN / Roll no." },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "department", label: "Department / Branch" },
  { key: "year", label: "Year / Semester" },
  { key: "team", label: "Team name" },
];

// Order matters: a header is claimed by the first field that matches, so the
// specific ones (email, phone, team) go before the broad "name" one -- "Team
// name" must map to team, not name.
const FIELD_PATTERNS = [
  ["email", [/e-?mail/i]],
  ["phone", [/phone/i, /mobile/i, /whats ?app/i, /contact (no|number|num)/i]],
  ["usn", [/\busn\b/i, /roll/i, /reg(istration|\.)?\s*(no|number|num|id)/i, /university seat/i, /student id/i]],
  ["team", [/^team(\s*name)?$/i, /team\s*name/i, /name of (the )?team/i, /group(\s*name)?$/i]],
  ["year", [/^year\b/i, /\byear (of study|of studying)/i, /semester/i, /^sem\b/i]],
  ["department", [/department/i, /\bdept\b/i, /branch/i, /^course$/i, /stream/i]],
  ["name", [/^(your |full |student |participant'?s? |candidate )?name$/i, /^name of (the )?(participant|student|candidate)/i, /^full name/i]],
];

// Returns { field: columnIndex | -1 } guessed from the header row.
export function guessColumnMapping(headers) {
  const mapping = Object.fromEntries(IMPORT_FIELDS.map((f) => [f.key, -1]));
  const claimed = new Set();
  for (const [field, patterns] of FIELD_PATTERNS) {
    const idx = headers.findIndex((h, i) => !claimed.has(i) && patterns.some((p) => p.test(String(h).trim())));
    if (idx !== -1) { mapping[field] = idx; claimed.add(idx); }
  }
  return mapping;
}

// Turns parsed rows (first row = headers) + a mapping into the payload the
// import RPC takes. Every column NOT mapped to a core field is kept in
// `extra` under its original header, so nothing in the form is lost.
export function buildImportRows(table, mapping) {
  if (table.length < 2) return [];
  const headers = table[0].map((h) => String(h).trim());
  const mappedCols = new Set(Object.values(mapping).filter((i) => i >= 0));
  const extraCols = headers.map((h, i) => ({ h, i })).filter(({ h, i }) => h && !mappedCols.has(i));

  return table.slice(1).map((cells) => {
    const get = (i) => (i >= 0 && i < cells.length ? String(cells[i]).trim() : "");
    const row = {};
    for (const { key } of IMPORT_FIELDS) row[key] = get(mapping[key]);
    row.extra = {};
    for (const { h, i } of extraCols) {
      const v = get(i);
      if (v !== "") row.extra[h] = v;
    }
    return row;
  });
}

// ---------------------------------------------------------------------------
// TABLE: FILTER / SORT
// ---------------------------------------------------------------------------

export function filterParticipants(list, { query = "", team = "all", attendance = "all", source = "all", showCancelled = false } = {}) {
  const q = query.trim().toLowerCase();
  return list.filter((p) => {
    if (!showCancelled && p.status === "cancelled") return false;
    if (team === "none" && p.team_id) return false;
    if (team !== "all" && team !== "none" && p.team_id !== team) return false;
    if (attendance === "present" && !p.attended) return false;
    if (attendance === "absent" && p.attended) return false;
    if (source !== "all" && p.source !== source) return false;
    if (q) {
      const hay = [p.name, p.usn, p.email, p.phone, p.department, p.year, ...Object.values(p.extra || {})]
        .filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

export function sortParticipants(list, key, dir = "asc", teamsById = {}) {
  const value = (p) => {
    if (key === "team") return teamsById[p.team_id]?.name || "";
    if (key === "attended") return p.attended ? 1 : 0;
    if (key.startsWith("extra:")) return (p.extra || {})[key.slice(6)] || "";
    return p[key] ?? "";
  };
  const factor = dir === "desc" ? -1 : 1;
  return [...list].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    // Blank values always sink to the bottom regardless of direction.
    if (va === "" && vb !== "") return 1;
    if (vb === "" && va !== "") return -1;
    if (typeof va === "number" && typeof vb === "number") return (va - vb) * factor;
    return String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" }) * factor;
  });
}

// All distinct `extra` keys across participants, in first-seen order -- these
// become the "form answers" columns of the table and the export.
export function collectExtraKeys(list) {
  const seen = new Set();
  for (const p of list) for (const k of Object.keys(p.extra || {})) seen.add(k);
  return [...seen];
}

// ---------------------------------------------------------------------------
// TEAM SPLITTING
// ---------------------------------------------------------------------------

// Deterministic PRNG so the tests (and "shuffle again") are reproducible.
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffled(items, rng) {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Splits `people` into teams that differ in size by at most one.
//   mode "count": `value` teams;  mode "size": teams of about `value` people.
//   balanceBy "department": spreads each department across the teams (rather
//   than letting a whole department land in one team).
// Returns { teamCount, teams: [[participantId, ...], ...] }. Pure: it does not
// touch the database -- the UI names the teams and saves the assignment.
export function splitIntoTeams(people, { mode = "count", value = 2, balanceBy = null, rng = Math.random } = {}) {
  const n = people.length;
  const v = Math.max(1, Math.floor(Number(value)) || 1);
  const teamCount = n === 0 ? 0 : Math.min(n, mode === "size" ? Math.ceil(n / v) : v);
  const teams = Array.from({ length: teamCount }, () => []);
  if (teamCount === 0) return { teamCount, teams };

  let ordered;
  if (balanceBy === "department") {
    const groups = new Map();
    for (const p of people) {
      const key = (p.department || "").trim().toLowerCase();
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    // biggest groups first, each shuffled internally, then dealt round-robin
    ordered = [...groups.values()]
      .sort((a, b) => b.length - a.length)
      .flatMap((g) => shuffled(g, rng));
  } else {
    ordered = shuffled(people, rng);
  }

  // Snake deal (0,1,2,2,1,0,0,1,2...) so the earlier -- larger -- groups don't
  // always pile their remainder onto the same team.
  ordered.forEach((p, i) => {
    const lap = Math.floor(i / teamCount);
    const pos = i % teamCount;
    teams[lap % 2 === 0 ? pos : teamCount - 1 - pos].push(p.id);
  });
  return { teamCount, teams };
}

// "Team 1", "Team 2"... skipping any name already taken (case-insensitive).
export function nextTeamNames(count, existingNames = [], prefix = "Team") {
  const taken = new Set(existingNames.map((n) => n.trim().toLowerCase()));
  const names = [];
  let i = 1;
  while (names.length < count) {
    const candidate = `${prefix} ${i++}`;
    if (!taken.has(candidate.toLowerCase())) names.push(candidate);
  }
  return names;
}

// ---------------------------------------------------------------------------
// STATS + EXPORT
// ---------------------------------------------------------------------------

export function summarize(list) {
  const active = list.filter((p) => p.status !== "cancelled");
  const present = active.filter((p) => p.attended).length;
  return {
    total: active.length,
    present,
    absent: active.length - present,
    unteamed: active.filter((p) => !p.team_id).length,
    rate: active.length ? Math.round((present / active.length) * 100) : 0,
  };
}

export function teamStats(list, teams) {
  const active = list.filter((p) => p.status !== "cancelled");
  return teams.map((t) => {
    const members = active.filter((p) => p.team_id === t.id);
    return { team: t, size: members.length, present: members.filter((m) => m.attended).length };
  });
}

// Header + rows for downloadCsv(). Includes every form answer column.
export function buildParticipantsExport(list, teamsById, extraKeys = collectExtraKeys(list)) {
  const header = ["Name", "USN", "Email", "Phone", "Department", "Year", "Team", "Attendance", "Marked at", "Source", "Registration", "Notes", ...extraKeys];
  const rows = list.map((p) => [
    p.name || "", p.usn || "", p.email || "", p.phone || "", p.department || "", p.year || "",
    teamsById[p.team_id]?.name || "",
    p.attended ? "Present" : "Absent",
    p.attended_at ? new Date(p.attended_at).toLocaleString() : "",
    p.source === "app" ? "CampusOS" : p.source === "import" ? "Form / CSV" : "Added manually",
    p.status === "cancelled" ? "Cancelled" : "Registered",
    p.notes || "",
    ...extraKeys.map((k) => (p.extra || {})[k] || ""),
  ]);
  return { header, rows };
}

export function exportFileName(eventTitle, suffix) {
  const base = String(eventTitle || "event").replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "event";
  return `${base}-${suffix}.csv`;
}
