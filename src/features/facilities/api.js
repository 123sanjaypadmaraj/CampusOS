// Data layer for the facilities staff dashboard (doc §30-33): the ticket
// queue and pending resource bookings. Both RPCs (transition_ticket_status,
// set_booking_status) and the tickets.read/tickets.update/bookings.approve
// permissions already existed on the facilities_staff role -- this file
// just re-exports the mvpService.js wrappers, same pattern as
// features/vendor/api.js and features/admin/api.js.

export {
  listActiveTickets,
  transitionTicketStatus,
  listPendingBookings,
  setBookingStatus,
} from "../../services/mvpService";
