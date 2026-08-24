// Same VITE_SUPABASE_* stub App.test.js uses -- lib/supabase.ts creates its
// client at import time, and AdminCMS.jsx pulls that in transitively via
// ./api. This only exercises the pure CSV-parsing helper, not rendering.
process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";

// require(), not import -- import statements are hoisted above the
// process.env assignment above, which would run too late (same reason
// App.test.js requires App rather than importing it).
const { parseRosterCsv } = require("./AdminCMS");

describe("parseRosterCsv", () => {
  it("maps a header row onto each data row", () => {
    const csv = "usn,name,department,course,year,person_type,email\n" +
      "1NH22CS201,Jane Doe,CSE,B.E,3,student,jane@nhce.edu.in";
    expect(parseRosterCsv(csv)).toEqual([
      { usn: "1NH22CS201", name: "Jane Doe", department: "CSE", course: "B.E", year: "3", person_type: "student", email: "jane@nhce.edu.in" },
    ]);
  });

  it("lowercases header names and trims cell whitespace", () => {
    const csv = "USN, Name \n 1nh22cs202 , John Smith ";
    expect(parseRosterCsv(csv)).toEqual([{ usn: "1nh22cs202", name: "John Smith" }]);
  });

  it("skips blank rows", () => {
    const csv = "usn,name\n1NH22CS201,Jane\n\n1NH22CS202,John";
    expect(parseRosterCsv(csv)).toHaveLength(2);
  });

  it("returns an empty array for header-only or empty input", () => {
    expect(parseRosterCsv("usn,name")).toEqual([]);
    expect(parseRosterCsv("")).toEqual([]);
  });

  it("handles a quoted field containing a comma (via the shared parseCsv tokenizer)", () => {
    const csv = 'usn,name\n1NH22CS201,"Doe, Jane"';
    expect(parseRosterCsv(csv)).toEqual([{ usn: "1NH22CS201", name: "Doe, Jane" }]);
  });
});
