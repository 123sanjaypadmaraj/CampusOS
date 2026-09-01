import { downloadCsv } from "./csv";

// downloadCsv drives real DOM/Blob/URL APIs to trigger a browser download --
// stub just enough of that plumbing to capture the Blob content it builds,
// without actually clicking a link in jsdom.
function captureCsv(header, rows) {
  let text;
  const realCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = jest.fn((blob) => {
    text = blob;
    return "blob:mock";
  });
  const realRevoke = URL.revokeObjectURL;
  URL.revokeObjectURL = jest.fn();
  const clickSpy = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

  downloadCsv("test.csv", header, rows);

  URL.createObjectURL = realCreateObjectURL;
  URL.revokeObjectURL = realRevoke;
  clickSpy.mockRestore();
  return text;
}

// jsdom's Blob has neither .text() nor a global Response to fall back on --
// FileReader is the one blob-reading API it does implement.
function blobText(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsText(blob);
  });
}

describe("downloadCsv", () => {
  it("quotes and escapes plain fields", async () => {
    const blob = captureCsv(["Name", "Note"], [["Alice \"A\" Smith", "line1,line2"]]);
    const text = await blobText(blob);
    expect(text).toContain('"Alice ""A"" Smith"');
    expect(text).toContain('"line1,line2"');
  });

  // CWE-1236 / CSV formula injection: a cell starting with =, +, -, @, or a
  // tab/CR is evaluated as a formula by Excel/Sheets on open, regardless of
  // CSV quoting. club_applications.message and similar exported fields are
  // free text from an unprivileged user (an applicant), so this must be
  // neutralized before it reaches an exporting club leader's spreadsheet.
  it.each([
    ["=HYPERLINK(\"http://evil/steal\",\"click\")", "'=HYPERLINK"],
    ["+1+1", "'+1+1"],
    ["-1+1", "'-1+1"],
    ["@SUM(1,1)", "'@SUM"],
  ])("neutralizes a formula-injection payload %s", async (payload) => {
    const blob = captureCsv(["Message"], [[payload]]);
    const text = await blobText(blob);
    expect(text).toContain(`"'${payload.replace(/"/g, '""')}"`);
  });

  it("leaves ordinary text starting with a letter/number untouched", async () => {
    const blob = captureCsv(["Name"], [["Priya Sharma", "1st place"]]);
    const text = await blobText(blob);
    expect(text).toContain('"Priya Sharma"');
    expect(text).toContain('"1st place"');
  });

  it("neutralizes a leading '-' even in an innocuous-looking name (e.g. a hyphenated surname)", async () => {
    const blob = captureCsv(["Name"], [["-priya"]]);
    const text = await blobText(blob);
    expect(text).toContain("'-priya");
  });
});
