/**
 * PRINT
 *
 * Rate cards, file upload/validation, job pricing, payment, and cancellation/refund.
 */

import { supabase } from "../../lib/supabase";
import { throwIfError } from "./_shared.js";

export const PRINT_FILE_MAX_BYTES = 26214400; // 25MB, mirrors the print-files bucket's own limit
const PRINT_FILE_ALLOWED_TYPES = ["application/pdf"];

// Real, honest structural validation (file type + size) run before ever
// touching the network -- not virus scanning (deliberately out of scope,
// no AV engine is reachable from an Edge Function in this deployment), just
// the same checks the bucket enforces server-side anyway, surfaced as a
// friendly error instead of a raw storage-API failure.
export function validatePrintFile(file) {
  if (!file) throw new Error("Choose a document.");
  const looksLikePdf = file.type
    ? PRINT_FILE_ALLOWED_TYPES.includes(file.type)
    : /\.pdf$/i.test(file.name || "");
  if (!looksLikePdf) {
    throw new Error("Only PDF files can be printed.");
  }
  if (file.size > PRINT_FILE_MAX_BYTES) {
    throw new Error(`File is too large (max ${PRINT_FILE_MAX_BYTES / 1024 / 1024}MB).`);
  }
}

export async function getPrintRateCard(campusId) {
  let query = supabase.from("print_rate_card").select("*");
  if (campusId) query = query.eq("campus_id", campusId);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function getPrintBindingRates(campusId) {
  let query = supabase.from("print_binding_rates").select("*");
  query = campusId ? query.eq("campus_id", campusId).maybeSingle() : query.limit(1).maybeSingle();
  const { data, error } = await query;
  throwIfError(error);
  return data || null;
}

export async function getPrintShopStatus(campusId) {
  let query = supabase.from("print_shop_status").select("*");
  query = campusId ? query.eq("campus_id", campusId).maybeSingle() : query.limit(1).maybeSingle();
  const { data, error } = await query;
  throwIfError(error);
  return data || null;
}

// Two-step flow: upload the file + create an AWAITING_PAYMENT job (price is
// computed server-side from the rate card, never trusted from the browser),
// then the caller drives startPrintJobPayment() to actually charge for it.
// A job that's never paid for just expires (see 20260817001200_printing_v2.sql).
export async function uploadPrintJob({
  userId,
  file,
  pages = 1,
  copies = 1,
  colorMode = "black_white",
  paperSize = "A4",
  binding = "none",
  duplex = false,
}) {
  if (!userId) {
    throw new Error("Please sign in first.");
  }

  validatePrintFile(file);

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${userId}/${crypto.randomUUID()}-${safeName}`;

  const { error: uploadError } = await supabase.storage
    .from("print-files")
    .upload(path, file, {
      cacheControl: "3600",
      upsert: false,
      contentType: file.type || "application/octet-stream",
    });

  throwIfError(uploadError);

  // Price is computed server-side from the campus rate card inside
  // create_print_job() (doc §29, §66) -- calculatePrintJobPrice() is only
  // used for the pre-upload UI estimate, never as the charged amount.
  // `file_url` stores the storage path; only the owner or print.manage/admin
  // can ever resolve it to a signed URL (storage RLS), never a raw link.
  const { data: job, error: jobError } = await supabase.rpc("create_print_job", {
    p_file_url: path,
    p_file_name: file.name,
    p_pages: Number(pages),
    p_copies: Number(copies),
    p_color_mode: colorMode,
    p_paper_size: paperSize,
    p_binding: binding || "none",
    p_duplex: Boolean(duplex),
    p_file_size_bytes: file.size ?? null,
  });

  if (jobError) {
    await supabase.storage.from("print-files").remove([path]);
    throw new Error(jobError.message || "Unable to create print job");
  }

  return job;
}

// Mirrors startFoodOrderPayment() -- asks create-razorpay-order for a
// gateway order to open Checkout against; the job only actually becomes
// UPLOADED (visible to the print shop) once razorpay-webhook verifies the
// payment server-side.
export async function startPrintJobPayment(printJobId) {
  const { data, error } = await supabase.functions.invoke("create-razorpay-order", {
    body: { print_job_id: printJobId },
  });
  if (error) throw new Error(error.message || "Unable to start payment");
  return data; // { key_id, gateway_order_id, amount, currency, payment_id }
}

// Self-service cancellation (doc §29 "Cancellation"/"Refund"). Only legal
// before printing has actually started -- see cancel_print_job()'s own
// status check. If a captured payment existed, a 'pending' refund row comes
// back too; the caller is expected to immediately drive it through the
// razorpay-refund Edge Function the same way a vendor-initiated food refund
// does (see startPrintJobRefund below).
export async function cancelPrintJob(jobId, reason) {
  const { data, error } = await supabase.rpc("cancel_print_job", {
    p_job_id: jobId,
    p_reason: reason || null,
  });
  throwIfError(error);
  return data; // { job, refund_id }
}

export async function startPrintJobRefund(refundId) {
  const { data, error } = await supabase.functions.invoke("razorpay-refund", {
    body: { refund_id: refundId },
  });
  if (error) throw new Error(error.message || "Unable to process refund");
  return data;
}

// A student re-opening their own past job's file (e.g. to confirm what they
// uploaded) -- same signed-URL convention as documents/club-files/message
// attachments (300s). Storage RLS already restricts this to the owner.
export async function getMyPrintFileUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("print-files").createSignedUrl(path, 300);
  throwIfError(error);
  return data?.signedUrl || null;
}

export async function getMyPrintJobs(userId) {
  if (!userId) return [];

  const { data, error } = await supabase
    .from("print_jobs")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  throwIfError(error);

  return data || [];
}


