// Must stay in exact sync with supabase/functions/signup-with-usn's
// usnToEmail() -- both sides derive the same synthetic, never-shown email
// from a USN so login (client-side signInWithPassword) resolves to the same
// Supabase Auth account that signup (server-side, via the Edge Function)
// created.

// NHCE's real USN structure: 1 batch digit + "NH" (college code) + 2 batch
// year digits + 2 branch-code letters + 3 roll digits, e.g. "1NH22CS201".
// Previously just /^[A-Za-z0-9]{10}$/ -- any 10 alphanumeric characters --
// which accepted anything the same length, not an actual NHCE USN.
export const USN_PATTERN = /^\dNH\d{2}[A-Za-z]{2}\d{3}$/i;

export function isValidUsn(usn: string): boolean {
  return USN_PATTERN.test(usn.trim());
}

export function usnToEmail(usn: string): string {
  return `${usn.trim().toLowerCase()}@usn.campusos.internal`;
}
