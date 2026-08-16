/**
 * Unit tests for the client-side parts of the data layer: cart grouping
 * sent to create_food_order(), the {code, message} error-shape parsing
 * (doc §81), and the waitlist branch of event registration. The
 * authoritative pricing/permission/state-machine logic itself lives in
 * Postgres (supabase/migrations/) and is exercised by the RPC contract
 * these tests assert against, not re-implemented here.
 */

const mockFrom = jest.fn();

jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
    auth: { linkIdentity: jest.fn() },
    from: (...args) => mockFrom(...args),
  },
}));

import { supabase } from "../lib/supabase";
import {
  createFoodOrder,
  registerEvent,
  isValidPhone,
  transitionOrderStatus,
  startFoodOrderPayment,
  connectGithub,
  deriveGithubUrlFromIdentities,
  connectLinkedin,
  markLinkedinVerified,
  hasLinkedinIdentity,
  markMarketplaceListingSold,
  touchActivity,
  getResources,
  logClientError,
  listErrorLogs,
  setErrorLogResolved,
  listMyEmergencyContacts,
  upsertEmergencyContact,
  deleteEmergencyContact,
  listPendingEmergencyContacts,
  verifyEmergencyContact,
  getEmergencyContactsForAlert,
  getSavedEvents,
  getCampusEvents,
  getCampusFood,
  getUserNotifications,
} from "./mvpService";

describe("createFoodOrder", () => {
  beforeEach(() => jest.clearAllMocks());

  it("groups duplicate cart entries into quantities before calling the RPC", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "order-1", status: "PAYMENT_PENDING" }, error: null });

    await createFoodOrder({
      userId: "user-1",
      canteenId: "canteen-1",
      cart: [
        { id: "item-1", price: 55 },
        { id: "item-1", price: 55 },
        { id: "item-2", price: 90 },
      ],
      idempotencyKey: "key-1",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_food_order", {
      p_canteen_id: "canteen-1",
      p_items: [
        { food_item_id: "item-1", quantity: 2, special_instructions: null },
        { food_item_id: "item-2", quantity: 1, special_instructions: null },
      ],
      p_notes: "",
      p_fulfillment_type: "pickup",
      p_idempotency_key: "key-1",
    });
  });

  it("strips the ORDER_* code prefix from the RPC error before surfacing it", async () => {
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "ORDER_ITEM_UNAVAILABLE: Masala Dosa is currently unavailable" },
    });

    await expect(
      createFoodOrder({ userId: "user-1", canteenId: "canteen-1", cart: [{ id: "item-1", price: 55 }] })
    ).rejects.toThrow("Masala Dosa is currently unavailable");
  });

  it("rejects locally without calling the RPC when the cart is empty", async () => {
    await expect(
      createFoodOrder({ userId: "user-1", canteenId: "canteen-1", cart: [] })
    ).rejects.toThrow(/cart is empty/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("requires sign-in before ever touching the network", async () => {
    await expect(
      createFoodOrder({ userId: null, canteenId: "canteen-1", cart: [{ id: "item-1" }] })
    ).rejects.toThrow(/sign in/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("registerEvent", () => {
  beforeEach(() => jest.clearAllMocks());

  it("sends the contact phone, name, roll number and department along with the event id", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "confirmed", registration_id: "reg-1" }, error: null });

    await registerEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      contactPhone: "9876543210",
      contactName: "Alice Test",
      rollNumber: "42",
      department: "CSE",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("register_for_event", {
      p_event_id: "11111111-1111-4111-8111-111111111111",
      p_contact_phone: "9876543210",
      p_contact_name: "Alice Test",
      p_roll_number: "42",
      p_department: "CSE",
    });
  });

  it("sends null for roll number/department when left blank", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "confirmed" }, error: null });

    await registerEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      contactPhone: "9876543210",
      contactName: "Alice Test",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("register_for_event", {
      p_event_id: "11111111-1111-4111-8111-111111111111",
      p_contact_phone: "9876543210",
      p_contact_name: "Alice Test",
      p_roll_number: null,
      p_department: null,
    });
  });

  it("returns the waitlist position when the RPC reports the event is full", async () => {
    supabase.rpc.mockResolvedValue({ data: { status: "waitlisted", position: 4 }, error: null });

    const result = await registerEvent({
      eventId: "11111111-1111-4111-8111-111111111111",
      userId: "user-1",
      contactPhone: "9876543210",
      contactName: "Alice Test",
    });

    expect(result).toEqual({ status: "waitlisted", position: 4 });
  });

  it("rejects locally without calling the RPC when the phone number is missing or invalid", async () => {
    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: "user-1", contactPhone: "", contactName: "Alice" })
    ).rejects.toThrow(/valid phone number/i);

    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: "user-1", contactPhone: "abc123", contactName: "Alice" })
    ).rejects.toThrow(/valid phone number/i);

    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("rejects locally without calling the RPC when the name is blank", async () => {
    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: "user-1", contactPhone: "9876543210", contactName: "  " })
    ).rejects.toThrow(/enter a name/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("requires sign-in before ever touching the network", async () => {
    await expect(
      registerEvent({ eventId: "11111111-1111-4111-8111-111111111111", userId: null, contactPhone: "9876543210", contactName: "Alice" })
    ).rejects.toThrow(/sign in/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});

describe("isValidPhone", () => {
  it("accepts 7-15 digit numbers with an optional leading +", () => {
    expect(isValidPhone("9876543210")).toBe(true);
    expect(isValidPhone("+919876543210")).toBe(true);
    expect(isValidPhone(" 9876543210 ")).toBe(true);
  });

  it("rejects too-short, too-long, and non-numeric input", () => {
    expect(isValidPhone("12345")).toBe(false);
    expect(isValidPhone("1234567890123456")).toBe(false);
    expect(isValidPhone("98765-43210")).toBe(false);
    expect(isValidPhone("")).toBe(false);
    expect(isValidPhone(null)).toBe(false);
    expect(isValidPhone(undefined)).toBe(false);
  });
});

describe("connectGithub", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls linkIdentity with the github provider and a redirect back to the app", async () => {
    supabase.auth.linkIdentity.mockResolvedValue({ error: null });

    await connectGithub();

    expect(supabase.auth.linkIdentity).toHaveBeenCalledWith({
      provider: "github",
      options: { redirectTo: expect.stringContaining("http") },
    });
  });

  it("throws Supabase's error (e.g. provider not configured) instead of swallowing it", async () => {
    // Real Supabase auth errors (AuthApiError) are actual Error instances,
    // not plain objects -- match that shape here, since Jest's toThrow()
    // only recognizes real Errors.
    supabase.auth.linkIdentity.mockResolvedValue({ error: new Error("Unsupported provider") });

    await expect(connectGithub()).rejects.toThrow("Unsupported provider");
  });
});

describe("connectLinkedin", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls linkIdentity with the linkedin_oidc provider", async () => {
    supabase.auth.linkIdentity.mockResolvedValue({ error: null });

    await connectLinkedin();

    expect(supabase.auth.linkIdentity).toHaveBeenCalledWith({
      provider: "linkedin_oidc",
      options: { redirectTo: expect.stringContaining("http") },
    });
  });

  it("throws on error instead of swallowing it", async () => {
    supabase.auth.linkIdentity.mockResolvedValue({ error: new Error("Unsupported provider") });
    await expect(connectLinkedin()).rejects.toThrow("Unsupported provider");
  });
});

describe("markLinkedinVerified", () => {
  it("calls the mark_linkedin_verified RPC and returns the updated profile", async () => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: { id: "user-1", linkedin_verified_at: "2026-08-14T00:00:00Z" }, error: null });

    const result = await markLinkedinVerified();

    expect(supabase.rpc).toHaveBeenCalledWith("mark_linkedin_verified");
    expect(result.linkedin_verified_at).toBe("2026-08-14T00:00:00Z");
  });

  it("surfaces LINKEDIN_NOT_LINKED with a clean message", async () => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "LINKEDIN_NOT_LINKED: link a LinkedIn account first" } });

    await expect(markLinkedinVerified()).rejects.toThrow("link a LinkedIn account first");
  });
});

describe("hasLinkedinIdentity", () => {
  it("detects a linked linkedin_oidc identity", () => {
    expect(hasLinkedinIdentity([{ provider: "linkedin_oidc" }])).toBe(true);
    expect(hasLinkedinIdentity([{ provider: "email" }])).toBe(false);
    expect(hasLinkedinIdentity([])).toBe(false);
    expect(hasLinkedinIdentity(null)).toBe(false);
  });
});

describe("deriveGithubUrlFromIdentities", () => {
  it("builds a github.com URL from the linked identity's username", () => {
    const identities = [
      { provider: "email", identity_data: {} },
      { provider: "github", identity_data: { user_name: "octocat" } },
    ];
    expect(deriveGithubUrlFromIdentities(identities)).toBe("https://github.com/octocat");
  });

  it("falls back to preferred_username when user_name is absent", () => {
    const identities = [{ provider: "github", identity_data: { preferred_username: "octocat2" } }];
    expect(deriveGithubUrlFromIdentities(identities)).toBe("https://github.com/octocat2");
  });

  it("returns null when there's no linked github identity", () => {
    expect(deriveGithubUrlFromIdentities([{ provider: "email", identity_data: {} }])).toBeNull();
    expect(deriveGithubUrlFromIdentities([])).toBeNull();
    expect(deriveGithubUrlFromIdentities(null)).toBeNull();
  });
});

describe("transitionOrderStatus", () => {
  it("rejects an illegal transition surfaced by the DB state machine", async () => {
    jest.clearAllMocks();
    supabase.rpc.mockResolvedValue({
      data: null,
      error: { message: "ORDER_INVALID_TRANSITION: cannot move READY -> PAID" },
    });

    await expect(transitionOrderStatus("order-1", "PAID")).rejects.toThrow("cannot move READY -> PAID");
  });
});

describe("startFoodOrderPayment", () => {
  it("invokes the create-razorpay-order Edge Function with the order id", async () => {
    jest.clearAllMocks();
    supabase.functions.invoke.mockResolvedValue({
      data: { key_id: "rzp_test_x", gateway_order_id: "order_x", amount: 6775, currency: "INR" },
      error: null,
    });

    const result = await startFoodOrderPayment("order-1");

    expect(supabase.functions.invoke).toHaveBeenCalledWith("create-razorpay-order", { body: { order_id: "order-1" } });
    expect(result.gateway_order_id).toBe("order_x");
  });

  it("surfaces a friendly error when the gateway isn't configured", async () => {
    jest.clearAllMocks();
    supabase.functions.invoke.mockResolvedValue({
      data: null,
      error: { message: "GATEWAY_NOT_CONFIGURED" },
    });

    await expect(startFoodOrderPayment("order-1")).rejects.toThrow();
  });
});

describe("markMarketplaceListingSold", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes a null buyer id when none is given (sold off-platform)", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "listing-1", status: "sold" }, error: null });

    await markMarketplaceListingSold({ listingId: "listing-1" });

    expect(supabase.rpc).toHaveBeenCalledWith("mark_listing_sold", { p_listing_id: "listing-1", p_buyer_id: null });
  });

  it("passes the selected buyer id through to the RPC", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "listing-1", status: "sold", buyer_id: "buyer-1" }, error: null });

    const result = await markMarketplaceListingSold({ listingId: "listing-1", buyerId: "buyer-1" });

    expect(supabase.rpc).toHaveBeenCalledWith("mark_listing_sold", { p_listing_id: "listing-1", p_buyer_id: "buyer-1" });
    expect(result.buyer_id).toBe("buyer-1");
  });

  it("surfaces the RPC's error (e.g. not the seller / already sold)", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Listing not found or not yours to update") });

    await expect(markMarketplaceListingSold({ listingId: "listing-1" })).rejects.toThrow(/not yours to update/);
  });
});

describe("touchActivity", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls the touch_activity RPC with no arguments", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    await touchActivity();

    expect(supabase.rpc).toHaveBeenCalledWith("touch_activity");
  });

  it("swallows RPC errors instead of throwing -- this is a fire-and-forget ping", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "network error" } });

    await expect(touchActivity()).resolves.not.toThrow();
  });
});

describe("getResources", () => {
  beforeEach(() => jest.clearAllMocks());

  // Regression test: this used to query/filter on `active`, a legacy
  // column some pre-existing installs happened to carry -- `available` is
  // the schema's canonical column (supabase/migrations/
  // 20260814000700_services_bookings.sql) and the only one guaranteed to
  // exist. Querying `active` 42703'd outright on a project whose resources
  // table never had it, silently emptying the resource list app-wide.
  it("selects and filters on the canonical `available` column, not the legacy `active` one", async () => {
    const mockResponse = { data: [{ id: "r1", name: "Seminar Hall", available: true }], error: null };
    const builder = {
      select: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      order: jest.fn(() => builder),
      then: (resolve) => Promise.resolve(mockResponse).then(resolve),
    };
    mockFrom.mockReturnValue(builder);

    const result = await getResources("campus-1");

    expect(mockFrom).toHaveBeenCalledWith("resources");
    expect(builder.select.mock.calls[0][0]).toContain("available");
    expect(builder.select.mock.calls[0][0]).not.toMatch(/\bactive\b/);
    expect(builder.eq).toHaveBeenCalledWith("available", true);
    expect(builder.eq).toHaveBeenCalledWith("campus_id", "campus-1");
    expect(result).toEqual([{ id: "r1", name: "Seminar Hall", available: true }]);
  });
});

describe("logClientError", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls log_client_error with the message/severity/context, truncated fields", async () => {
    supabase.rpc.mockResolvedValue({ data: "log-id-1", error: null });

    await logClientError("Something broke", {
      stack: "Error: broke\n  at x",
      severity: "warning",
      context: { flow: "test" },
    });

    expect(supabase.rpc).toHaveBeenCalledWith("log_client_error", expect.objectContaining({
      p_message: "Something broke",
      p_stack: "Error: broke\n  at x",
      p_severity: "warning",
      p_context: { flow: "test" },
      p_source: "client",
    }));
  });

  // The whole point of this being fire-and-forget: a broken error-reporting
  // call must never itself throw and cascade into a second failure on top
  // of whatever it was trying to report.
  it("never throws even when the RPC call itself fails", async () => {
    supabase.rpc.mockRejectedValue(new Error("network down"));
    await expect(logClientError("Something broke")).resolves.toBeUndefined();
  });

  it("does not call the RPC at all for an empty message", async () => {
    await logClientError("");
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  // De-dupe within a tab session -- see the module-level fingerprint Set.
  it("only logs the first occurrence of an identical message+severity", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    const marker = `dedupe test ${Date.now()}`;
    await logClientError(marker, { severity: "error" });
    await logClientError(marker, { severity: "error" });
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });
});

describe("listErrorLogs / setErrorLogResolved (Admin CMS Errors tab)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("filters by severity and resolved, embeds the reporter's name", async () => {
    const mockResponse = { data: [{ id: "e1", message: "boom", severity: "error", resolved: false }], error: null };
    const builder = {
      select: jest.fn(() => builder),
      order: jest.fn(() => builder),
      limit: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      then: (resolve) => Promise.resolve(mockResponse).then(resolve),
    };
    mockFrom.mockReturnValue(builder);

    const result = await listErrorLogs({ severity: "error", resolved: false });

    expect(mockFrom).toHaveBeenCalledWith("error_logs");
    expect(builder.select.mock.calls[0][0]).toContain("reporter:profiles");
    expect(builder.eq).toHaveBeenCalledWith("severity", "error");
    expect(builder.eq).toHaveBeenCalledWith("resolved", false);
    expect(result).toEqual(mockResponse.data);
  });

  it("marks an error resolved", async () => {
    const mockResponse = { data: { id: "e1", resolved: true }, error: null };
    const builder = {
      update: jest.fn(() => builder),
      eq: jest.fn(() => builder),
      select: jest.fn(() => builder),
      single: jest.fn(() => Promise.resolve(mockResponse)),
    };
    mockFrom.mockReturnValue(builder);

    const result = await setErrorLogResolved("e1", true);

    expect(builder.update).toHaveBeenCalledWith({ resolved: true });
    expect(builder.eq).toHaveBeenCalledWith("id", "e1");
    expect(result).toEqual(mockResponse.data);
  });
});

describe("emergency contacts (doc §113, 20260815000600_emergency_contacts.sql)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("listMyEmergencyContacts selects the caller's contacts, primary first", async () => {
    const mockResponse = { data: [{ id: "c1", contact_name: "Mom", is_primary: true }], error: null };
    const builder = {
      select: jest.fn(() => builder),
      order: jest.fn(() => builder),
      then: (resolve) => Promise.resolve(mockResponse).then(resolve),
    };
    mockFrom.mockReturnValue(builder);

    const result = await listMyEmergencyContacts();

    expect(mockFrom).toHaveBeenCalledWith("emergency_contacts");
    expect(builder.order).toHaveBeenCalledWith("is_primary", { ascending: false });
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: true });
    expect(result).toEqual(mockResponse.data);
  });

  it("upsertEmergencyContact validates the phone client-side before ever calling the RPC", async () => {
    await expect(
      upsertEmergencyContact({ contactName: "Dad", relationship: "parent", phone: "not-a-phone" })
    ).rejects.toThrow(/valid phone number/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("upsertEmergencyContact requires a name", async () => {
    await expect(
      upsertEmergencyContact({ contactName: "  ", relationship: "parent", phone: "9876543210" })
    ).rejects.toThrow(/name is required/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("upsertEmergencyContact rejects an invalid alternate phone without dropping a valid primary one", async () => {
    await expect(
      upsertEmergencyContact({ contactName: "Dad", relationship: "parent", phone: "9876543210", altPhone: "bad" })
    ).rejects.toThrow(/alternate phone/i);
    expect(supabase.rpc).not.toHaveBeenCalled();
  });

  it("upsertEmergencyContact calls the RPC with trimmed fields and nulls for blanks", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "c1" }, error: null });

    await upsertEmergencyContact({
      contactName: "  Dad  ",
      relationship: "parent",
      phone: " 9876543210 ",
      altPhone: "",
      email: "",
      isPrimary: true,
    });

    expect(supabase.rpc).toHaveBeenCalledWith("upsert_emergency_contact", {
      p_id: null,
      p_contact_name: "Dad",
      p_relationship: "parent",
      p_phone: "9876543210",
      p_alt_phone: null,
      p_email: null,
      p_is_primary: true,
    });
  });

  it("upsertEmergencyContact passes the existing id through on an edit", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "c1" }, error: null });

    await upsertEmergencyContact({ id: "c1", contactName: "Mom", relationship: "parent", phone: "9876543210" });

    expect(supabase.rpc).toHaveBeenCalledWith("upsert_emergency_contact", expect.objectContaining({ p_id: "c1" }));
  });

  it("deleteEmergencyContact calls the RPC with the id", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    await deleteEmergencyContact("c1");
    expect(supabase.rpc).toHaveBeenCalledWith("delete_emergency_contact", { p_id: "c1" });
  });

  it("listPendingEmergencyContacts calls admin_list_pending_emergency_contacts", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: "c1" }], error: null });
    const result = await listPendingEmergencyContacts();
    expect(supabase.rpc).toHaveBeenCalledWith("admin_list_pending_emergency_contacts");
    expect(result).toEqual([{ id: "c1" }]);
  });

  it("verifyEmergencyContact calls the RPC with id/verified/notes", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "c1", verified: true }, error: null });
    await verifyEmergencyContact("c1", true, "called and confirmed");
    expect(supabase.rpc).toHaveBeenCalledWith("verify_emergency_contact", {
      p_id: "c1",
      p_verified: true,
      p_notes: "called and confirmed",
    });
  });

  // The SOS-response integration point: a responder pulls a student's
  // contacts scoped to one real alert, not a standing directory browse.
  it("getEmergencyContactsForAlert calls the RPC with the alert id and returns the list", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: "c1", contact_name: "Mom", verified: true }], error: null });
    const result = await getEmergencyContactsForAlert("alert-1");
    expect(supabase.rpc).toHaveBeenCalledWith("get_emergency_contacts_for_alert", { p_alert_id: "alert-1" });
    expect(result).toEqual([{ id: "c1", contact_name: "Mom", verified: true }]);
  });

  it("getEmergencyContactsForAlert returns an empty array when there's no data", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });
    const result = await getEmergencyContactsForAlert("alert-1");
    expect(result).toEqual([]);
  });
});

// Doc §9 "Offline Mode": the "previously loaded" read functions cache their
// last successful result (src/utils/offlineCache.js) and fall back to it
// when the network call fails, instead of throwing/emptying the screen.
// Each test below uses its own unique id so the cache keys never collide
// with another test in this file (the cache is a real module-level store,
// not reset between `it()`s).
describe("offline cache fallback (doc §9 'Offline Mode')", () => {
  beforeEach(() => jest.clearAllMocks());

  it("getSavedEvents serves the last cached list when the network call fails", async () => {
    const userId = "offline-user-saved-1";
    const okBuilder = {
      select: jest.fn(() => okBuilder),
      eq: jest.fn(() => okBuilder),
      then: (resolve) => Promise.resolve({ data: [{ event_id: "evt-1" }], error: null }).then(resolve),
    };
    mockFrom.mockReturnValueOnce(okBuilder);
    await expect(getSavedEvents(userId)).resolves.toEqual(["evt-1"]);

    const failBuilder = {
      select: jest.fn(() => failBuilder),
      eq: jest.fn(() => failBuilder),
      then: (resolve, reject) => Promise.reject(new Error("network down")).then(resolve, reject),
    };
    mockFrom.mockReturnValueOnce(failBuilder);
    await expect(getSavedEvents(userId)).resolves.toEqual(["evt-1"]);
  });

  it("getCampusEvents serves the last cached page when the network call fails", async () => {
    const campusId = "offline-campus-events-1";
    const okBuilder = {
      select: jest.fn(() => okBuilder),
      order: jest.fn(() => okBuilder),
      limit: jest.fn(() => okBuilder),
      eq: jest.fn(() => okBuilder),
      then: (resolve) => Promise.resolve({ data: [{ id: "e1", title: "Hack Night" }], error: null }).then(resolve),
    };
    mockFrom.mockReturnValueOnce(okBuilder);
    const first = await getCampusEvents(campusId);
    expect(first).toHaveLength(1);

    const failBuilder = {
      select: jest.fn(() => failBuilder),
      order: jest.fn(() => failBuilder),
      limit: jest.fn(() => failBuilder),
      eq: jest.fn(() => failBuilder),
      then: (resolve, reject) => Promise.reject(new Error("offline")).then(resolve, reject),
    };
    mockFrom.mockReturnValueOnce(failBuilder);
    await expect(getCampusEvents(campusId)).resolves.toEqual(first);
  });

  it("getCampusEvents does NOT fall back to the cache for a paginated (cursor) request", async () => {
    const campusId = "offline-campus-events-2";
    const okBuilder = {
      select: jest.fn(() => okBuilder),
      order: jest.fn(() => okBuilder),
      limit: jest.fn(() => okBuilder),
      eq: jest.fn(() => okBuilder),
      then: (resolve) => Promise.resolve({ data: [{ id: "e1" }], error: null }).then(resolve),
    };
    mockFrom.mockReturnValueOnce(okBuilder);
    await getCampusEvents(campusId); // populate the cache for the first page

    const failBuilder = {
      select: jest.fn(() => failBuilder),
      order: jest.fn(() => failBuilder),
      limit: jest.fn(() => failBuilder),
      eq: jest.fn(() => failBuilder),
      gt: jest.fn(() => failBuilder),
      then: (resolve, reject) => Promise.reject(new Error("offline")).then(resolve, reject),
    };
    mockFrom.mockReturnValueOnce(failBuilder);
    await expect(getCampusEvents(campusId, { cursor: "2026-01-01" })).rejects.toThrow("offline");
  });

  it("getUserNotifications serves the last cached list when the network call errors", async () => {
    const userId = "offline-user-notif-1";
    const okBuilder = {
      select: jest.fn(() => okBuilder),
      eq: jest.fn(() => okBuilder),
      order: jest.fn(() => okBuilder),
      limit: jest.fn(() => okBuilder),
      then: (resolve) =>
        Promise.resolve({
          data: [{ id: "n1", created_at: "2026-08-16T00:00:00Z", read: false }],
          error: null,
        }).then(resolve),
    };
    mockFrom.mockReturnValueOnce(okBuilder);
    const first = await getUserNotifications(userId);
    expect(first).toHaveLength(1);

    const failBuilder = {
      select: jest.fn(() => failBuilder),
      eq: jest.fn(() => failBuilder),
      order: jest.fn(() => failBuilder),
      limit: jest.fn(() => failBuilder),
      then: (resolve) => Promise.resolve({ data: null, error: { message: "network error" } }).then(resolve),
    };
    mockFrom.mockReturnValueOnce(failBuilder);
    await expect(getUserNotifications(userId)).resolves.toEqual(first);
  });

  it("getCampusFood serves the last cached menu when the network call fails", async () => {
    const campusId = "offline-campus-food-1";
    const canteenBuilder = {
      select: jest.fn(() => canteenBuilder),
      eq: jest.fn(() => canteenBuilder),
      order: jest.fn(() => canteenBuilder),
      then: (resolve) =>
        Promise.resolve({ data: [{ id: "c1", name: "Udupi", eta_min: 5, eta_max: 10 }], error: null }).then(
          resolve
        ),
    };
    const foodBuilder = {
      select: jest.fn(() => foodBuilder),
      eq: jest.fn(() => foodBuilder),
      order: jest.fn(() => foodBuilder),
      then: (resolve) =>
        Promise.resolve({ data: [{ id: "f1", canteen_id: "c1", name: "Dosa", price: 50 }], error: null }).then(
          resolve
        ),
    };
    mockFrom.mockReturnValueOnce(canteenBuilder).mockReturnValueOnce(foodBuilder);
    const first = await getCampusFood(campusId);
    expect(first.canteens).toHaveLength(1);
    expect(first.items).toHaveLength(1);

    const failBuilder = {
      select: jest.fn(() => failBuilder),
      eq: jest.fn(() => failBuilder),
      order: jest.fn(() => failBuilder),
      then: (resolve, reject) => Promise.reject(new Error("offline")).then(resolve, reject),
    };
    mockFrom.mockReturnValueOnce(failBuilder).mockReturnValueOnce(failBuilder);
    await expect(getCampusFood(campusId)).resolves.toEqual(first);
  });
});
