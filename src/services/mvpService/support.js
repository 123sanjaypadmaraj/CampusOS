/**
 * SUPPORT TICKETS (supabase/migrations/20260819000600_support_tickets.sql)
 */

import { supabase } from "../../lib/supabase";
import { compressImage, throwIfError } from "./_shared.js";
import { logStorageErrorIfAny } from "./errorLogging.js";

export async function createSupportTicket({ category, subject, description, attachmentUrl = null }) {
  const { data, error } = await supabase.rpc("create_support_ticket", {
    p_category: category, p_subject: subject, p_description: description || "", p_attachment_url: attachmentUrl,
  });
  throwIfError(error);
  return data;
}

// support-media is a private bucket (20260819001100_support_priority_
// escalation_attachments.sql) -- a payment/account screenshot can carry
// personal info, so unlike post-media/lost-found-media this is never
// public-read. Stores the object path, not a public URL; the path is what
// gets saved on the message row, and getSupportAttachmentUrl() below signs
// it on demand for whoever's allowed to see it.
export async function uploadSupportAttachment(file, ownerId) {
  if (!ownerId) throw new Error("Please sign in first.");
  const compressed = await compressImage(file);
  const path = `${ownerId}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;
  const { error } = await supabase.storage.from("support-media").upload(path, compressed, { contentType: "image/jpeg" });
  logStorageErrorIfAny("support-media", error);
  throwIfError(error);
  return path;
}

export async function getSupportAttachmentUrl(path) {
  if (!path) return null;
  const { data, error } = await supabase.storage.from("support-media").createSignedUrl(path, 3600);
  throwIfError(error);
  return data?.signedUrl || null;
}

export async function getMySupportTickets(userId) {
  const { data, error } = await supabase.from("support_tickets").select("*").eq("user_id", userId).order("created_at", { ascending: false });
  throwIfError(error);
  return data || [];
}

export async function listSupportTicketsAdmin({ status = null } = {}) {
  let query = supabase.from("support_tickets")
    .select("*, reporter:profiles!support_tickets_user_id_fkey(name,email), assignee:profiles!support_tickets_assigned_to_fkey(name)")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  throwIfError(error);
  return data || [];
}

export async function getSupportTicketMessages(ticketId) {
  const { data, error } = await supabase.from("support_ticket_messages")
    .select("*, sender:profiles!support_ticket_messages_sender_id_fkey(name)")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  throwIfError(error);
  return data || [];
}

export async function addSupportTicketMessage(ticketId, body, attachmentUrl = null) {
  const { data, error } = await supabase.rpc("add_support_ticket_message", { p_ticket_id: ticketId, p_body: body, p_attachment_url: attachmentUrl });
  throwIfError(error);
  return data;
}

export async function setSupportTicketStatus(ticketId, status) {
  const { data, error } = await supabase.rpc("set_support_ticket_status", { p_ticket_id: ticketId, p_status: status });
  throwIfError(error);
  return data;
}

export async function setSupportTicketPriority(ticketId, priority) {
  const { data, error } = await supabase.rpc("set_support_ticket_priority", { p_ticket_id: ticketId, p_priority: priority });
  throwIfError(error);
  return data;
}

// Owner or staff; sets priority to urgent and notifies the support.manage/
// admin pool for the ticket's campus (see the RPC's own header for why
// there's no separate escalation tier).
export async function escalateSupportTicket(ticketId, reason = "") {
  const { data, error } = await supabase.rpc("escalate_support_ticket", { p_ticket_id: ticketId, p_reason: reason || null });
  throwIfError(error);
  return data;
}

export async function assignSupportTicket(ticketId, staffId) {
  const { data, error } = await supabase.rpc("assign_support_ticket", { p_ticket_id: ticketId, p_staff_id: staffId });
  throwIfError(error);
  return data;
}

/* =========================================================================
   SUPPORT / HELP CENTRE FAQ (supabase/migrations/20260819001200_support_faq.sql)
========================================================================= */

// Public read (works signed-out) -- global rows (campus_id null) plus
// whatever's scoped to the caller's own campus, same fallback shape as
// getCampusContactInfo above.
export async function getSupportFaqs(campusId) {
  let query = supabase.from("support_faqs").select("*").eq("is_active", true).order("category").order("sort_order");
  const { data, error } = campusId
    ? await query.or(`campus_id.is.null,campus_id.eq.${campusId}`)
    : await query.is("campus_id", null);
  throwIfError(error);
  return data || [];
}

export async function adminListSupportFaqs() {
  const { data, error } = await supabase.from("support_faqs").select("*").order("category").order("sort_order");
  throwIfError(error);
  return data || [];
}

export async function adminUpsertSupportFaq({ id = null, campusId = null, category, question, answer, sortOrder = 0, isActive = true }) {
  const { data, error } = await supabase.rpc("admin_upsert_support_faq", {
    p_id: id, p_campus_id: campusId, p_category: category, p_question: question,
    p_answer: answer, p_sort_order: sortOrder, p_is_active: isActive,
  });
  throwIfError(error);
  return data;
}

export async function adminDeleteSupportFaq(id) {
  const { error } = await supabase.rpc("admin_delete_support_faq", { p_id: id });
  throwIfError(error);
}

