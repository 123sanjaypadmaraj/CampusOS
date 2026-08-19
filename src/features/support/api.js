// Data layer for the student-facing Support Center (module 42, new --
// supabase/migrations/20260819000600_support_tickets.sql). Re-exports the
// mvpService.js wrappers, same pattern as features/facilities/api.js.

export {
  createSupportTicket,
  getMySupportTickets,
  getSupportTicketMessages,
  addSupportTicketMessage,
  getCampusContactInfo,
} from "../../services/mvpService";
