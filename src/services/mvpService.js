/*
|--------------------------------------------------------------------------
| CampusOS data layer
|--------------------------------------------------------------------------
| Browser-safe Supabase client only.
| Never put the service_role key in the frontend.
|--------------------------------------------------------------------------
| This file used to be a single ~4,000-line module. It's now a barrel that
| re-exports every domain module under ./mvpService/ so every existing
| `import { ... } from "../services/mvpService"` call site across the app
| keeps working unchanged -- only the internal organization changed, not
| the public API. Find a function by its domain below, or grep this repo
| for its name; every export here still lives in exactly one submodule.
|
|   ./mvpService/_shared.js         internal helpers (not part of the public API)
|   ./mvpService/errorLogging.js    client/admin error monitoring
|   ./mvpService/auth.js            sign-in/sign-up/session/identity linking
|   ./mvpService/campus.js          campus lookup
|   ./mvpService/profile.js         own profile + people directory
|   ./mvpService/adminUsers.js      admin: user/role/status/deletion management
|   ./mvpService/adminAi.js         admin: AI assistant access, knowledge, usage
|   ./mvpService/moderation.js      admin: reports, moderation actions, banned words
|   ./mvpService/orgRequests.js     club/vendor org creation requests
|   ./mvpService/verification.js    student ID verification
|   ./mvpService/posts.js           campus feed posts, likes, comments
|   ./mvpService/clubs.js           club listing + membership
|   ./mvpService/events.js          events, registration, tickets, roster, feedback
|   ./mvpService/food.js            canteens/menu + food order lifecycle
|   ./mvpService/payments.js        shared payment-record helpers
|   ./mvpService/print.js           print shop: rate cards, jobs, payment
|   ./mvpService/campusServices.js  service requests + resource booking
|   ./mvpService/facilitiesStaff.js facilities staff dashboard queue
|   ./mvpService/notifications.js   in-app notifications + preferences
|   ./mvpService/realtime.js        shared realtime subscribe() helpers
|   ./mvpService/reporting.js       content reporting + audit trail
|   ./mvpService/emergency.js       SOS alerts + emergency contacts
|   ./mvpService/emergencyDirectory.js campus emergency directory
|   ./mvpService/support.js         support tickets + help centre FAQ
|   ./mvpService/resourceCatalog.js resource catalog management
|   ./mvpService/vendorAccounts.js  vendor manager accounts (store/print)
|   ./mvpService/lostAndFound.js    lost & found items + photo matching
|--------------------------------------------------------------------------
*/

export * from "./mvpService/errorLogging.js";
export * from "./mvpService/auth.js";
export * from "./mvpService/campus.js";
export * from "./mvpService/profile.js";
export * from "./mvpService/adminUsers.js";
export * from "./mvpService/adminAi.js";
export * from "./mvpService/moderation.js";
export * from "./mvpService/orgRequests.js";
export * from "./mvpService/verification.js";
export * from "./mvpService/posts.js";
export * from "./mvpService/clubs.js";
export * from "./mvpService/events.js";
export * from "./mvpService/food.js";
export * from "./mvpService/payments.js";
export * from "./mvpService/print.js";
export * from "./mvpService/campusServices.js";
export * from "./mvpService/facilitiesStaff.js";
export * from "./mvpService/notifications.js";
export * from "./mvpService/realtime.js";
export * from "./mvpService/reporting.js";
export * from "./mvpService/emergency.js";
export * from "./mvpService/emergencyDirectory.js";
export * from "./mvpService/support.js";
export * from "./mvpService/resourceCatalog.js";
export * from "./mvpService/vendorAccounts.js";
export * from "./mvpService/lostAndFound.js";
