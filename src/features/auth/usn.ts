// Must stay in exact sync with supabase/functions/signup-with-usn's
// usnToEmail() -- both sides derive the same synthetic, never-shown email
// from a USN so login (client-side signInWithPassword) resolves to the same
// Supabase Auth account that signup (server-side, via the Edge Function)
// created.

export const USN_PATTERN = /^[A-Za-z0-9]{10}$/;

export function isValidUsn(usn: string): boolean {
  return USN_PATTERN.test(usn.trim());
}

export function usnToEmail(usn: string): string {
  return `${usn.trim().toLowerCase()}@usn.campusos.internal`;
}
