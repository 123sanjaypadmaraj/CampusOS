/**
 * VENDOR MANAGER ACCOUNTS -- store/print (supabase/migrations/
 * 20260819000300_vendor_manager_accounts.sql). Canteen's equivalents
 * (listCanteenStaffAccounts/add/removeCanteenStaffAccount) already live in
 * src/features/vendor/api.js -- these two extend the same mechanism to
 * store and print.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export async function listStoreStaffAccounts(storeId) {
  const { data, error } = await supabase.from("store_staff_accounts").select("*, profiles(name,email)").eq("store_id", storeId);
  throwIfError(error);
  return data || [];
}

export async function addStoreStaffAccount(storeId, email) {
  const { data, error } = await supabase.rpc("add_store_staff_account", { p_store_id: storeId, p_email: email });
  throwIfError(error);
  return data;
}

export async function removeStoreStaffAccount(staffAccountId) {
  const { error } = await supabase.rpc("remove_store_staff_account", { p_staff_account_id: staffAccountId });
  throwIfError(error);
}

export async function listPrintStaffAccounts(campusId) {
  const { data, error } = await supabase.from("print_staff_accounts").select("*, profiles(name,email)").eq("campus_id", campusId);
  throwIfError(error);
  return data || [];
}

export async function addPrintStaffAccount(campusId, email) {
  const { data, error } = await supabase.rpc("add_print_staff_account", { p_campus_id: campusId, p_email: email });
  throwIfError(error);
  return data;
}

export async function removePrintStaffAccount(staffAccountId) {
  const { error } = await supabase.rpc("remove_print_staff_account", { p_staff_account_id: staffAccountId });
  throwIfError(error);
}

