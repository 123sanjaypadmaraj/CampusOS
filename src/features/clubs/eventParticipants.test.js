import {
  parseDelimited, detectDelimiter, guessColumnMapping, buildImportRows,
  filterParticipants, sortParticipants, collectExtraKeys,
  splitIntoTeams, nextTeamNames, mulberry32, summarize, teamStats,
  buildParticipantsExport, exportFileName,
} from "./eventParticipants";

describe("parseDelimited", () => {
  it("parses a Google Forms style CSV with quotes, commas and newlines in cells", () => {
    const csv = 'Timestamp,Name,Why do you want to join?\r\n"2026/09/01 10:00:00",Asha,"Because, well,\nreasons ""quoted"""\r\n';
    const rows = parseDelimited(csv);
    expect(rows).toEqual([
      ["Timestamp", "Name", "Why do you want to join?"],
      ["2026/09/01 10:00:00", "Asha", 'Because, well,\nreasons "quoted"'],
    ]);
  });

  it("strips a BOM and ignores blank lines", () => {
    expect(parseDelimited("﻿a,b\n\n1,2\n\n")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("handles tab-separated text pasted from a spreadsheet", () => {
    expect(detectDelimiter("Name\tEmail\tPhone")).toBe("\t");
    expect(parseDelimited("Name\tEmail\nAsha\ta@x.com")).toEqual([["Name", "Email"], ["Asha", "a@x.com"]]);
  });

  it("handles semicolon-separated files and does not count delimiters inside quotes", () => {
    expect(detectDelimiter('"a,b,c";d;e')).toBe(";");
  });

  it("returns [] for empty input", () => {
    expect(parseDelimited("")).toEqual([]);
    expect(parseDelimited("   \n ")).toEqual([]);
    expect(parseDelimited(null)).toEqual([]);
  });

  it("keeps a trailing empty cell", () => {
    expect(parseDelimited("a,b,c\n1,2,")).toEqual([["a", "b", "c"], ["1", "2", ""]]);
  });
});

describe("guessColumnMapping", () => {
  it("maps typical Google Forms headers", () => {
    const headers = ["Timestamp", "Full Name", "Email Address", "USN", "Phone Number", "Department", "Year of Study", "Team Name", "Any dietary needs?"];
    const m = guessColumnMapping(headers);
    expect(m).toEqual({ name: 1, usn: 3, email: 2, phone: 4, department: 5, year: 6, team: 7 });
  });

  it("maps 'Team Name' to team, never to name", () => {
    const m = guessColumnMapping(["Team Name", "Your Name"]);
    expect(m.team).toBe(0);
    expect(m.name).toBe(1);
  });

  it("recognises roll / registration number as USN and WhatsApp as phone", () => {
    const m = guessColumnMapping(["Name", "Registration Number", "WhatsApp no"]);
    expect(m.usn).toBe(1);
    expect(m.phone).toBe(2);
  });

  it("leaves unmatched fields at -1 and never claims one column twice", () => {
    const m = guessColumnMapping(["Email", "Comments"]);
    expect(m.email).toBe(0);
    expect(m.name).toBe(-1);
    const used = Object.values(m).filter((i) => i >= 0);
    expect(new Set(used).size).toBe(used.length);
  });
});

describe("buildImportRows", () => {
  const table = [
    ["Timestamp", "Name", "Email", "Track", "Notes"],
    ["t1", " Asha ", "asha@x.com", "AI", ""],
    ["t2", "Ravi", "ravi@x.com", "Web", "vegan"],
  ];
  const mapping = { name: 1, usn: -1, email: 2, phone: -1, department: -1, year: -1, team: -1 };

  it("maps core fields and keeps every other non-empty column in extra under its header", () => {
    const rows = buildImportRows(table, mapping);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ name: "Asha", email: "asha@x.com", usn: "", team: "" });
    expect(rows[0].extra).toEqual({ Timestamp: "t1", Track: "AI" });
    expect(rows[1].extra).toEqual({ Timestamp: "t2", Track: "Web", Notes: "vegan" });
  });

  it("tolerates short rows and returns [] when there is no data row", () => {
    expect(buildImportRows([["Name"]], mapping)).toEqual([]);
    const rows = buildImportRows([["Name", "Email"], ["Only name"]], { ...mapping, name: 0, email: 1 });
    expect(rows[0]).toMatchObject({ name: "Only name", email: "" });
  });
});

const P = (over) => ({ id: "x", name: "", status: "registered", attended: false, source: "import", team_id: null, extra: {}, ...over });

describe("filterParticipants", () => {
  const list = [
    P({ id: "1", name: "Asha", usn: "1NH21CS001", department: "CSE", team_id: "t1", attended: true, source: "app" }),
    P({ id: "2", name: "Ravi", email: "ravi@x.com", department: "ECE", team_id: null, extra: { Track: "Robotics" } }),
    P({ id: "3", name: "Meera", status: "cancelled" }),
  ];

  it("hides cancelled by default and shows them on request", () => {
    expect(filterParticipants(list).map((p) => p.id)).toEqual(["1", "2"]);
    expect(filterParticipants(list, { showCancelled: true })).toHaveLength(3);
  });

  it("searches across core fields and form answers, case-insensitively", () => {
    expect(filterParticipants(list, { query: "1nh21" }).map((p) => p.id)).toEqual(["1"]);
    expect(filterParticipants(list, { query: "robotics" }).map((p) => p.id)).toEqual(["2"]);
  });

  it("filters by team, no-team, attendance and source", () => {
    expect(filterParticipants(list, { team: "t1" }).map((p) => p.id)).toEqual(["1"]);
    expect(filterParticipants(list, { team: "none" }).map((p) => p.id)).toEqual(["2"]);
    expect(filterParticipants(list, { attendance: "present" }).map((p) => p.id)).toEqual(["1"]);
    expect(filterParticipants(list, { attendance: "absent" }).map((p) => p.id)).toEqual(["2"]);
    expect(filterParticipants(list, { source: "import" }).map((p) => p.id)).toEqual(["2"]);
  });
});

describe("sortParticipants", () => {
  it("sorts naturally, sinks blanks last in both directions, and does not mutate input", () => {
    const list = [P({ id: "a", name: "Team 10" }), P({ id: "b", name: "" }), P({ id: "c", name: "Team 2" })];
    const copy = [...list];
    expect(sortParticipants(list, "name", "asc").map((p) => p.id)).toEqual(["c", "a", "b"]);
    expect(sortParticipants(list, "name", "desc").map((p) => p.id)).toEqual(["a", "c", "b"]);
    expect(list).toEqual(copy);
  });

  it("sorts by team name and by form-answer column", () => {
    const teams = { t1: { name: "Zeta" }, t2: { name: "Alpha" } };
    const list = [P({ id: "1", team_id: "t1", extra: { Track: "B" } }), P({ id: "2", team_id: "t2", extra: { Track: "A" } })];
    expect(sortParticipants(list, "team", "asc", teams).map((p) => p.id)).toEqual(["2", "1"]);
    expect(sortParticipants(list, "extra:Track", "asc").map((p) => p.id)).toEqual(["2", "1"]);
  });
});

describe("collectExtraKeys", () => {
  it("returns distinct keys in first-seen order", () => {
    expect(collectExtraKeys([P({ extra: { B: "1", A: "2" } }), P({ extra: { A: "x", C: "y" } })])).toEqual(["B", "A", "C"]);
  });
});

describe("splitIntoTeams", () => {
  const people = Array.from({ length: 10 }, (_, i) => P({ id: `p${i}`, department: i < 6 ? "CSE" : "ECE" }));

  it("splits into N teams whose sizes differ by at most one, covering everyone exactly once", () => {
    const { teamCount, teams } = splitIntoTeams(people, { mode: "count", value: 3, rng: mulberry32(1) });
    expect(teamCount).toBe(3);
    const sizes = teams.map((t) => t.length).sort();
    expect(sizes).toEqual([3, 3, 4]);
    expect(teams.flat().sort()).toEqual(people.map((p) => p.id).sort());
  });

  it("splits by team size", () => {
    const { teamCount, teams } = splitIntoTeams(people, { mode: "size", value: 4, rng: mulberry32(2) });
    expect(teamCount).toBe(3);
    expect(Math.max(...teams.map((t) => t.length)) - Math.min(...teams.map((t) => t.length))).toBeLessThanOrEqual(1);
  });

  it("never makes more teams than people, and handles an empty list", () => {
    expect(splitIntoTeams(people.slice(0, 2), { mode: "count", value: 5 }).teamCount).toBe(2);
    expect(splitIntoTeams([], { mode: "count", value: 3 })).toEqual({ teamCount: 0, teams: [] });
  });

  it("clamps nonsense values to at least one team", () => {
    expect(splitIntoTeams(people, { mode: "count", value: 0 }).teamCount).toBe(1);
    expect(splitIntoTeams(people, { mode: "size", value: -5 }).teamCount).toBe(10);
  });

  it("balanceBy department spreads a department across teams", () => {
    const { teams } = splitIntoTeams(people, { mode: "count", value: 2, balanceBy: "department", rng: mulberry32(3) });
    const cse = (t) => t.filter((id) => people.find((p) => p.id === id).department === "CSE").length;
    expect(Math.abs(cse(teams[0]) - cse(teams[1]))).toBeLessThanOrEqual(1);
  });

  it("is reproducible for a given seed", () => {
    const a = splitIntoTeams(people, { mode: "count", value: 3, rng: mulberry32(42) });
    const b = splitIntoTeams(people, { mode: "count", value: 3, rng: mulberry32(42) });
    expect(a).toEqual(b);
  });
});

describe("nextTeamNames", () => {
  it("skips names already taken, case-insensitively", () => {
    expect(nextTeamNames(3, ["team 1", "Team 3"])).toEqual(["Team 2", "Team 4", "Team 5"]);
  });
});

describe("summarize / teamStats", () => {
  const list = [
    P({ id: "1", attended: true, team_id: "t1" }),
    P({ id: "2", attended: false, team_id: "t1" }),
    P({ id: "3", attended: true }),
    P({ id: "4", status: "cancelled", attended: true, team_id: "t1" }),
  ];
  it("ignores cancelled registrations", () => {
    expect(summarize(list)).toEqual({ total: 3, present: 2, absent: 1, unteamed: 1, rate: 67 });
    expect(summarize([])).toEqual({ total: 0, present: 0, absent: 0, unteamed: 0, rate: 0 });
  });
  it("counts team size and attendance", () => {
    expect(teamStats(list, [{ id: "t1", name: "A" }])).toEqual([{ team: { id: "t1", name: "A" }, size: 2, present: 1 }]);
  });
});

describe("buildParticipantsExport / exportFileName", () => {
  it("emits core columns then every form-answer column, and labels attendance and source", () => {
    const list = [P({ name: "Asha", team_id: "t1", attended: true, source: "app", extra: { Track: "AI" } }), P({ name: "Ravi", extra: {} })];
    const { header, rows } = buildParticipantsExport(list, { t1: { name: "Alpha" } });
    expect(header.slice(0, 8)).toEqual(["Name", "USN", "Email", "Phone", "Department", "Year", "Team", "Attendance"]);
    expect(header[header.length - 1]).toBe("Track");
    expect(rows[0][6]).toBe("Alpha");
    expect(rows[0][7]).toBe("Present");
    expect(rows[0][9]).toBe("CampusOS");
    expect(rows[0][rows[0].length - 1]).toBe("AI");
    expect(rows[1][7]).toBe("Absent");
    expect(rows[1][rows[1].length - 1]).toBe("");
    expect(rows[0]).toHaveLength(header.length);
  });

  it("builds a filesystem-safe file name", () => {
    expect(exportFileName("Hack/Day: 2026!", "teams")).toBe("Hack_Day_2026-teams.csv");
    expect(exportFileName("", "attendance")).toBe("event-attendance.csv");
  });
});
