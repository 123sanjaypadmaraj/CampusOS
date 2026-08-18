import { isValidUsn, usnToEmail } from "./usn";

describe("isValidUsn", () => {
  test("accepts real NHCE USN shapes", () => {
    expect(isValidUsn("1NH22CS201")).toBe(true);
    expect(isValidUsn("1NH25CS265")).toBe(true);
    expect(isValidUsn("1nh22is202")).toBe(true); // case-insensitive
    expect(isValidUsn("  1NH22EC203  ")).toBe(true); // trims
  });

  test("rejects anything that isn't the real NHCE structure, even if it's 10 alphanumeric characters", () => {
    expect(isValidUsn("ABCDEFGHIJ")).toBe(false);
    expect(isValidUsn("1234567890")).toBe(false);
    expect(isValidUsn("1XX22CS201")).toBe(false); // wrong college code
    expect(isValidUsn("1NH2CS2010")).toBe(false); // wrong digit grouping
    expect(isValidUsn("")).toBe(false);
    expect(isValidUsn("1NH22CS20")).toBe(false); // too short
    expect(isValidUsn("1NH22CS2011")).toBe(false); // too long
  });
});

describe("usnToEmail", () => {
  test("derives the same deterministic synthetic email regardless of case/whitespace", () => {
    expect(usnToEmail("1NH22CS201")).toBe("1nh22cs201@usn.campusos.internal");
    expect(usnToEmail(" 1nh22cs201 ")).toBe("1nh22cs201@usn.campusos.internal");
  });
});
