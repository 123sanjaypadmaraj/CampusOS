// One-off script: creates one leadership login per club in the real club
// catalog (supabase/migrations/20260831000100_club_catalog_seed.sql, 30
// clubs across Co-Curricular/Technical and Extra-Curricular), via the Admin
// Auth API, and makes each account the 'owner' in public.club_members for
// its club.
//
// Unlike scripts/setup-vendor-accounts.mjs, this does NOT touch
// profiles.role -- club leadership isn't a global account role, it's a
// per-club club_members.role (owner/president/.../member, see
// src/features/clubs/ClubManage.jsx), so being 'owner' of one club's row is
// everything the account needs to sign in via the "Club login" tab and land
// on that club's full Manage Club dashboard (members, applications w/
// CSV export, events, meetings/attendance, announcements, gallery,
// documents, analytics). The club's real president/officers can be added
// as additional members afterwards and promoted to a leadership role from
// that same dashboard -- this account exists so the club has a working
// login from day one, not to be the club's only leader forever.
//
// Usage: node scripts/setup-club-accounts.mjs                       (staging)
//        node scripts/setup-club-accounts.mjs --env=production --yes-production
// Prints emails/passwords to stdout and writes them to the gitignored
// scripts/.club-credentials[.staging].local.json.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { resolveTarget, runProjectSql } from "./env-target.mjs";

const { SUPABASE_URL, SERVICE_ROLE_KEY, projectRef, root, target } = resolveTarget();
const credentialsFile = target === "production" ? ".club-credentials.local.json" : ".club-credentials.staging.local.json";

// Matches supabase/migrations/20260831000100_club_catalog_seed.sql exactly
// (name must match for the club_id lookup below to find the right row).
const CLUBS = [
  // Co-Curricular / Technical Clubs
  { name: "Emsys Next Gen Club", email: "emsys.club@nhce.edu.in" },
  { name: "Business & Information Technology Club (B.I.T Club)", email: "bit.club@nhce.edu.in" },
  { name: "Healthxxcel Club", email: "healthxcel.club@nhce.edu.in" },
  { name: "Cybersecurity & Ethical Hacking Club", email: "cybersecurity.club@nhce.edu.in" },
  { name: "Data Analytics Club", email: "dataanalytics.club@nhce.edu.in" },
  { name: "Mobile App Development Club", email: "mobiledev.club@nhce.edu.in" },
  { name: "Aerobots Club", email: "aerobots.club@nhce.edu.in" },
  { name: "FOSS Club", email: "foss.club@nhce.edu.in" },
  { name: "RoboHorizon Club", email: "robohorizon.club@nhce.edu.in" },
  { name: "Innovation Club", email: "innovation.club@nhce.edu.in" },
  { name: "EvolveAI Club", email: "evolveai.club@nhce.edu.in" },
  { name: "TechForge Club", email: "techforge.club@nhce.edu.in" },
  { name: "Entrepreneurship Development & Startup Club", email: "entrepreneurship.club@nhce.edu.in" },
  { name: "Green Energy Club", email: "greenenergy.club@nhce.edu.in" },
  { name: "STEM Club", email: "stem.club@nhce.edu.in" },
  // Extra-Curricular Clubs
  { name: "Alumni Club", email: "alumni.club@nhce.edu.in" },
  { name: "Music Club", email: "music.club@nhce.edu.in" },
  { name: "Art Club", email: "art.club@nhce.edu.in" },
  { name: "NSS Club", email: "nss.club@nhce.edu.in" },
  { name: "Leo Club", email: "leo.club@nhce.edu.in" },
  { name: "Drama Club", email: "drama.club@nhce.edu.in" },
  { name: "Literary Club", email: "literary.club@nhce.edu.in" },
  { name: "Fashion Club", email: "fashion.club@nhce.edu.in" },
  { name: "Fitness Club", email: "fitness.club@nhce.edu.in" },
  { name: "Rotaract Club", email: "rotaract.club@nhce.edu.in" },
  { name: "Green Warriors Club", email: "greenwarriors.club@nhce.edu.in" },
  { name: "Socio-Political Club", email: "sociopolitical.club@nhce.edu.in" },
  { name: "TEDx Club", email: "tedx.club@nhce.edu.in" },
  { name: "Media Club", email: "media.club@nhce.edu.in" },
  { name: "Dance Club", email: "dance.club@nhce.edu.in" },
];

function generatePassword() {
  // Same scheme as setup-vendor-accounts.mjs: 12 chars, unambiguous
  // alphabet, guaranteed one of each class.
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghijkmnopqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%";
  const all = upper + lower + digits + symbols;
  const pick = (chars) => chars[crypto.randomInt(chars.length)];
  let pwd = pick(upper) + pick(lower) + pick(digits) + pick(symbols);
  for (let i = pwd.length; i < 12; i++) pwd += pick(all);
  return pwd.split("").sort(() => crypto.randomInt(3) - 1).join("");
}

async function adminFetch(pathname, options = {}) {
  const res = await fetch(`${SUPABASE_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      apikey: SERVICE_ROLE_KEY,
      ...options.headers,
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

async function ensureClubOwnerUser(club) {
  const { data: list } = await adminFetch(`/auth/v1/admin/users?email=${encodeURIComponent(club.email)}`);
  let user = (list?.users || list)?.find?.((u) => u.email === club.email);
  let password = null;

  if (user) {
    console.log(`[skip] ${club.email} already exists (${user.id}) -- password not reset`);
  } else {
    password = generatePassword();
    const { ok, status, data } = await adminFetch("/auth/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        email: club.email,
        password,
        email_confirm: true,
        user_metadata: { name: club.name },
      }),
    });
    if (!ok) throw new Error(`Failed to create ${club.email}: ${status} ${JSON.stringify(data)}`);
    user = data;
    console.log(`[created] ${club.email} (${user.id})`);
  }

  // Ensure the profile's display name is right even if the row pre-existed.
  await adminFetch(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ name: club.name }),
  });

  return { userId: user.id, password };
}

async function findClubId(name) {
  const { ok, status, data } = await adminFetch(`/rest/v1/clubs?select=id&name=eq.${encodeURIComponent(name)}`);
  if (!ok) throw new Error(`Failed to look up club "${name}": ${status} ${JSON.stringify(data)}`);
  if (!data?.[0]?.id) throw new Error(`No club found named "${name}" -- run the 20260831000100_club_catalog_seed.sql migration first.`);
  return data[0].id;
}

function runSql(sql) {
  runProjectSql(root, projectRef, sql);
}

async function main() {
  const results = [];

  for (const club of CLUBS) {
    const clubId = await findClubId(club.name);
    const { userId, password } = await ensureClubOwnerUser(club);
    results.push({ ...club, clubId, userId, password });
  }

  // Make each account 'owner' of its club in one batch. club_members has a
  // unique(club_id, user_id) constraint -- upsert so a re-run (e.g. after a
  // password reset run) doesn't fail or demote an owner who's since been
  // promoted further by someone editing role assignments directly.
  const membershipSql = results
    .map((r) => `insert into public.club_members (club_id, user_id, role) values ('${r.clubId}', '${r.userId}', 'owner') on conflict (club_id, user_id) do update set role = 'owner';`)
    .join("\n");
  runSql(membershipSql);
  console.log("[done] assigned 'owner' club_members role for all clubs");

  const credentials = results.map((r) => ({
    club: r.name,
    email: r.email,
    password: r.password || "(pre-existing account -- password unchanged, not shown)",
    userId: r.userId,
    clubId: r.clubId,
  }));

  fs.writeFileSync(
    path.join(root, "scripts", credentialsFile),
    JSON.stringify(credentials, null, 2)
  );

  console.log(`\n=== Club login credentials (${target}, sign in via the "Club login" tab) ===\n`);
  for (const c of credentials) {
    console.log(`${c.club.padEnd(55)} ${c.email.padEnd(32)} ${c.password}`);
  }
  console.log(`\nAlso saved to scripts/${credentialsFile} (gitignored).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
