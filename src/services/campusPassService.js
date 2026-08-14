import { supabase } from "../lib/supabase";

/*
|--------------------------------------------------------------------------
| Digital campus pass -- signed, short-lived QR token
|--------------------------------------------------------------------------
| Backed by mint_campus_pass()/verify_campus_pass() in
| supabase/migrations/20260814004400_digital_campus_pass.sql -- both HMAC
| sign/verify entirely in Postgres (pgcrypto + Vault), ~90s token lifetime.
*/

export async function mintCampusPass() {
  const { data, error } = await supabase.rpc("mint_campus_pass");
  if (error) throw error;
  // RETURNS TABLE -> the JS client always hands back an array of rows.
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Could not generate a pass");
  return row;
}

export async function verifyCampusPass(token) {
  const { data, error } = await supabase.rpc("verify_campus_pass", { p_token: token });
  if (error) throw error;
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) throw new Error("Could not verify this pass");
  return row;
}
