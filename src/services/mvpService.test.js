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
    storage: { from: jest.fn() },
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
  getMyAccess,
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
  validatePrintFile,
  uploadPrintJob,
  startPrintJobPayment,
  cancelPrintJob,
  startPrintJobRefund,
  getMyPrintFileUrl,
  getPrintRateCard,
  getPrintBindingRates,
  getPrintShopStatus,
  adminGetConversationMessages,
  publishPost,
  uploadPostImage,
  getSavedPosts,
  toggleSavedPost,
  submitSuspensionAppeal,
  getMySuspensionAppeal,
  listBannedWords,
  addBannedWord,
  removeBannedWord,
  listSuspensionAppeals,
  resolveSuspensionAppeal,
} from "./mvpService";

describe("createFoodOrder", () => {
  beforeEach(() => jest.clearAllMocks());

  it("passes each cart entry's own quantity through to the RPC (not a re-derived count of array entries)", async () => {
    // mergeCartItem() (mvpHelpers.js) keeps the food cart as at most one
    // entry per distinct (item, variant, add-ons) with a real running
    // `.quantity` on that entry, never duplicate rows for the same line --
    // this used to silently drop that `.quantity` and place every order at
    // 1 no matter how many were in the cart. Regression test for that fix.
    supabase.rpc.mockResolvedValue({ data: { id: "order-1", status: "PAYMENT_PENDING" }, error: null });

    await createFoodOrder({
      userId: "user-1",
      canteenId: "canteen-1",
      cart: [
        { id: "item-1", price: 55, quantity: 3 },
        { id: "item-2", price: 90, quantity: 1 },
      ],
      idempotencyKey: "key-1",
    });

    expect(supabase.rpc).toHaveBeenCalledWith("create_food_order", {
      p_canteen_id: "canteen-1",
      p_items: [
        { food_item_id: "item-1", quantity: 3, special_instructions: null, variant_id: null, addon_option_ids: null },
        { food_item_id: "item-2", quantity: 1, special_instructions: null, variant_id: null, addon_option_ids: null },
      ],
      p_notes: "",
      p_fulfillment_type: "pickup",
      p_idempotency_key: "key-1",
    });
  });

  it("passes variant_id and addon_option_ids through when a cart line has them", async () => {
    supabase.rpc.mockResolvedValue({ data: { id: "order-1", status: "PAYMENT_PENDING" }, error: null });

    await createFoodOrder({
      userId: "user-1",
      canteenId: "canteen-1",
      cart: [{ id: "item-1", price: 120, quantity: 2, variantId: "variant-1", addonOptionIds: ["addon-a", "addon-b"] }],
      idempotencyKey: "key-2",
    });

    expect(supabase.rpc).toHaveBeenCalledWith(
      "create_food_order",
      expect.objectContaining({
        p_items: [
          { food_item_id: "item-1", quantity: 2, special_instructions: null, variant_id: "variant-1", addon_option_ids: ["addon-a", "addon-b"] },
        ],
      })
    );
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

describe("getMyAccess", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls get_my_access and normalizes the jsonb result", async () => {
    supabase.rpc.mockResolvedValue({
      data: { permissions: ["food.menu.write"], roles: ["vendor_staff"], is_admin: false },
      error: null,
    });

    const access = await getMyAccess();

    expect(supabase.rpc).toHaveBeenCalledWith("get_my_access");
    expect(access).toEqual({ permissions: ["food.menu.write"], roles: ["vendor_staff"], is_admin: false });
  });

  it("fails closed (empty access, not a throw) on an RPC error -- a permission gate should hide UI, not crash it", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: { message: "network error" } });
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const access = await getMyAccess();

    expect(access).toEqual({ permissions: [], roles: [], is_admin: false });
    errorSpy.mockRestore();
  });

  it("defaults missing fields on a malformed response instead of throwing", async () => {
    supabase.rpc.mockResolvedValue({ data: {}, error: null });

    const access = await getMyAccess();

    expect(access).toEqual({ permissions: [], roles: [], is_admin: false });
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

describe("adminGetConversationMessages (moderator-only message view for a conversation report)", () => {
  beforeEach(() => jest.clearAllMocks());

  it("calls admin_get_conversation_messages with the conversation id and a default limit", async () => {
    supabase.rpc.mockResolvedValue({ data: [{ id: "m1" }], error: null });

    const result = await adminGetConversationMessages("conv-1");

    expect(supabase.rpc).toHaveBeenCalledWith("admin_get_conversation_messages", {
      p_conversation_id: "conv-1",
      p_limit: 50,
    });
    expect(result).toEqual([{ id: "m1" }]);
  });

  it("returns [] instead of null", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: null });

    expect(await adminGetConversationMessages("conv-1")).toEqual([]);
  });

  it("throws when the caller isn't a moderator", async () => {
    supabase.rpc.mockResolvedValue({ data: null, error: new Error("Not authorized") });

    await expect(adminGetConversationMessages("conv-1")).rejects.toThrow("Not authorized");
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
    const hoursBuilder = {
      select: jest.fn(() => hoursBuilder),
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    const closuresBuilder = {
      select: jest.fn(() => closuresBuilder),
      gte: jest.fn(() => closuresBuilder),
      then: (resolve) => Promise.resolve({ data: [], error: null }).then(resolve),
    };
    mockFrom
      .mockReturnValueOnce(canteenBuilder)
      .mockReturnValueOnce(foodBuilder)
      .mockReturnValueOnce(hoursBuilder)
      .mockReturnValueOnce(closuresBuilder);
    const first = await getCampusFood(campusId);
    expect(first.canteens).toHaveLength(1);
    expect(first.items).toHaveLength(1);

    const failBuilder = {
      select: jest.fn(() => failBuilder),
      eq: jest.fn(() => failBuilder),
      order: jest.fn(() => failBuilder),
      gte: jest.fn(() => failBuilder),
      then: (resolve, reject) => Promise.reject(new Error("offline")).then(resolve, reject),
    };
    mockFrom
      .mockReturnValueOnce(failBuilder)
      .mockReturnValueOnce(failBuilder)
      .mockReturnValueOnce(failBuilder)
      .mockReturnValueOnce(failBuilder);
    await expect(getCampusFood(campusId)).resolves.toEqual(first);
  });
});

describe("printing (Phase 6)", () => {
  beforeAll(() => {
    if (!global.crypto.randomUUID) {
      global.crypto.randomUUID = () => "test-uuid";
    }
  });

  beforeEach(() => jest.clearAllMocks());

  describe("validatePrintFile", () => {
    it("rejects a non-PDF file by MIME type", () => {
      expect(() => validatePrintFile({ name: "photo.png", type: "image/png", size: 100 }))
        .toThrow("Only PDF files can be printed.");
    });

    it("falls back to the file extension when the browser gives no MIME type", () => {
      expect(() => validatePrintFile({ name: "notes.docx", type: "", size: 100 }))
        .toThrow("Only PDF files can be printed.");
      expect(() => validatePrintFile({ name: "notes.pdf", type: "", size: 100 })).not.toThrow();
    });

    it("rejects a file over the 25MB limit", () => {
      expect(() => validatePrintFile({ name: "big.pdf", type: "application/pdf", size: 26214401 }))
        .toThrow("File is too large");
    });

    it("accepts a valid PDF under the size limit", () => {
      expect(() => validatePrintFile({ name: "report.pdf", type: "application/pdf", size: 1000 })).not.toThrow();
    });

    it("requires a file at all", () => {
      expect(() => validatePrintFile(null)).toThrow("Choose a document.");
    });
  });

  describe("uploadPrintJob", () => {
    it("uploads the file then creates an AWAITING_PAYMENT job with every field, including duplex/size", async () => {
      const upload = jest.fn().mockResolvedValue({ error: null });
      const remove = jest.fn().mockResolvedValue({ error: null });
      supabase.storage.from.mockReturnValue({ upload, remove });
      supabase.rpc.mockResolvedValue({
        data: { id: "job-1", status: "AWAITING_PAYMENT", price: 140, pickup_code: "123456" },
        error: null,
      });

      const file = { name: "report.pdf", type: "application/pdf", size: 5000 };
      const job = await uploadPrintJob({
        userId: "user-1",
        file,
        pages: 10,
        copies: 2,
        colorMode: "colour",
        paperSize: "A3",
        binding: "spiral",
        duplex: true,
      });

      expect(upload).toHaveBeenCalledWith(
        "user-1/test-uuid-report.pdf",
        file,
        expect.objectContaining({ contentType: "application/pdf" })
      );
      expect(supabase.rpc).toHaveBeenCalledWith("create_print_job", {
        p_file_url: "user-1/test-uuid-report.pdf",
        p_file_name: "report.pdf",
        p_pages: 10,
        p_copies: 2,
        p_color_mode: "colour",
        p_paper_size: "A3",
        p_binding: "spiral",
        p_duplex: true,
        p_file_size_bytes: 5000,
      });
      expect(job.status).toBe("AWAITING_PAYMENT");
      expect(remove).not.toHaveBeenCalled();
    });

    it("removes the uploaded file if create_print_job() fails, instead of leaving an orphaned upload", async () => {
      const upload = jest.fn().mockResolvedValue({ error: null });
      const remove = jest.fn().mockResolvedValue({ error: null });
      supabase.storage.from.mockReturnValue({ upload, remove });
      supabase.rpc.mockResolvedValue({ data: null, error: { message: "RATE_LIMITED" } });

      await expect(
        uploadPrintJob({ userId: "user-1", file: { name: "a.pdf", type: "application/pdf", size: 10 } })
      ).rejects.toThrow();

      expect(remove).toHaveBeenCalledWith(["user-1/test-uuid-a.pdf"]);
    });

    it("rejects before ever touching storage when the file fails client-side validation", async () => {
      const upload = jest.fn();
      supabase.storage.from.mockReturnValue({ upload });

      await expect(
        uploadPrintJob({ userId: "user-1", file: { name: "notes.docx", type: "image/png", size: 10 } })
      ).rejects.toThrow("Only PDF files can be printed.");
      expect(upload).not.toHaveBeenCalled();
    });

    it("requires sign-in", async () => {
      await expect(uploadPrintJob({ file: { name: "a.pdf", type: "application/pdf", size: 10 } }))
        .rejects.toThrow("Please sign in first.");
    });
  });

  describe("startPrintJobPayment", () => {
    it("invokes create-razorpay-order with print_job_id", async () => {
      supabase.functions.invoke.mockResolvedValue({
        data: { key_id: "rzp_test_x", gateway_order_id: "order_y", amount: 1400, currency: "INR" },
        error: null,
      });

      const result = await startPrintJobPayment("job-1");

      expect(supabase.functions.invoke).toHaveBeenCalledWith("create-razorpay-order", {
        body: { print_job_id: "job-1" },
      });
      expect(result.gateway_order_id).toBe("order_y");
    });

    it("surfaces a friendly error when the gateway call fails", async () => {
      supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: "GATEWAY_NOT_CONFIGURED" } });
      await expect(startPrintJobPayment("job-1")).rejects.toThrow();
    });
  });

  describe("cancelPrintJob / startPrintJobRefund", () => {
    it("calls cancel_print_job with the job id and reason", async () => {
      supabase.rpc.mockResolvedValue({
        data: { job: { id: "job-1", status: "CANCELLED" }, refund_id: "refund-1" },
        error: null,
      });

      const result = await cancelPrintJob("job-1", "Changed my mind");

      expect(supabase.rpc).toHaveBeenCalledWith("cancel_print_job", { p_job_id: "job-1", p_reason: "Changed my mind" });
      expect(result.refund_id).toBe("refund-1");
    });

    it("passes null when no reason is given", async () => {
      supabase.rpc.mockResolvedValue({ data: { job: {}, refund_id: null }, error: null });
      await cancelPrintJob("job-1");
      expect(supabase.rpc).toHaveBeenCalledWith("cancel_print_job", { p_job_id: "job-1", p_reason: null });
    });

    it("invokes razorpay-refund with the refund id", async () => {
      supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
      await startPrintJobRefund("refund-1");
      expect(supabase.functions.invoke).toHaveBeenCalledWith("razorpay-refund", { body: { refund_id: "refund-1" } });
    });
  });

  describe("getMyPrintFileUrl", () => {
    it("resolves a signed URL for the caller's own file", async () => {
      const createSignedUrl = jest.fn().mockResolvedValue({ data: { signedUrl: "https://signed.example/report.pdf" }, error: null });
      supabase.storage.from.mockReturnValue({ createSignedUrl });

      const url = await getMyPrintFileUrl("user-1/abc-report.pdf");

      expect(createSignedUrl).toHaveBeenCalledWith("user-1/abc-report.pdf", 300);
      expect(url).toBe("https://signed.example/report.pdf");
    });

    it("returns null without calling storage when the path is already gone (file deleted)", async () => {
      const createSignedUrl = jest.fn();
      supabase.storage.from.mockReturnValue({ createSignedUrl });
      expect(await getMyPrintFileUrl(null)).toBeNull();
      expect(createSignedUrl).not.toHaveBeenCalled();
    });
  });

  describe("rate card / binding rates / shop status reads", () => {
    it("getPrintRateCard filters by campus when given one", async () => {
      const builder = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        then: (resolve) => Promise.resolve({ data: [{ color_mode: "colour", price_per_page: 8 }], error: null }).then(resolve),
      };
      mockFrom.mockReturnValue(builder);

      const rates = await getPrintRateCard("campus-1");

      expect(mockFrom).toHaveBeenCalledWith("print_rate_card");
      expect(builder.eq).toHaveBeenCalledWith("campus_id", "campus-1");
      expect(rates).toHaveLength(1);
    });

    it("getPrintBindingRates resolves a single row for the campus", async () => {
      const builder = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        maybeSingle: jest.fn().mockResolvedValue({ data: { staple_fee: 20, spiral_fee: 40 }, error: null }),
      };
      mockFrom.mockReturnValue(builder);

      const rates = await getPrintBindingRates("campus-1");

      expect(builder.eq).toHaveBeenCalledWith("campus_id", "campus-1");
      expect(rates.spiral_fee).toBe(40);
    });

    it("getPrintShopStatus resolves a single row for the campus", async () => {
      const builder = {
        select: jest.fn(() => builder),
        eq: jest.fn(() => builder),
        maybeSingle: jest.fn().mockResolvedValue({ data: { status: "online" }, error: null }),
      };
      mockFrom.mockReturnValue(builder);

      const status = await getPrintShopStatus("campus-1");

      expect(status.status).toBe("online");
    });
  });
});

// supabase/migrations/20260818000600_community_hardening.sql +
// mvpService.js additions -- saved posts, real post image upload,
// suspension appeals, admin profanity-filter/appeal management.
describe("Community hardening", () => {
  beforeEach(() => jest.clearAllMocks());

  describe("publishPost", () => {
    it("passes imageUrls through as image_urls on the insert", async () => {
      const builder = {
        insert: jest.fn(() => builder),
        select: jest.fn(() => builder),
        single: jest.fn(() => Promise.resolve({ data: { id: "post-1" }, error: null })),
      };
      mockFrom.mockReturnValue(builder);

      await publishPost({
        userId: "user-1",
        campusId: "campus-1",
        title: "Hello campus",
        tags: ["robotics"],
        imageUrls: ["https://x/img1.jpg"],
      });

      expect(builder.insert).toHaveBeenCalledWith(
        expect.objectContaining({ image_urls: ["https://x/img1.jpg"] })
      );
    });

    it("defaults image_urls to an empty array when none are given", async () => {
      const builder = {
        insert: jest.fn(() => builder),
        select: jest.fn(() => builder),
        single: jest.fn(() => Promise.resolve({ data: { id: "post-1" }, error: null })),
      };
      mockFrom.mockReturnValue(builder);

      await publishPost({ userId: "user-1", campusId: "campus-1", title: "Hi" });

      expect(builder.insert).toHaveBeenCalledWith(expect.objectContaining({ image_urls: [] }));
    });

    it("surfaces a clean message for a rejected duplicate/profanity post (CODE: message parsing)", async () => {
      const builder = {
        insert: jest.fn(() => builder),
        select: jest.fn(() => builder),
        single: jest.fn(() =>
          Promise.resolve({ data: null, error: { message: "DUPLICATE_POST: You already posted something very similar recently. Please wait a bit or change the content." } })
        ),
      };
      mockFrom.mockReturnValue(builder);

      await expect(
        publishPost({ userId: "user-1", campusId: "campus-1", title: "Hi" })
      ).rejects.toMatchObject({ code: "DUPLICATE_POST", message: expect.stringContaining("already posted") });
    });
  });

  describe("uploadPostImage", () => {
    it("uploads to the post-media bucket under the owner's folder and returns the public URL", async () => {
      const upload = jest.fn().mockResolvedValue({ error: null });
      const getPublicUrl = jest.fn().mockReturnValue({ data: { publicUrl: "https://cdn/post-media/user-1/x.jpg" } });
      supabase.storage.from.mockReturnValue({ upload, getPublicUrl });

      const url = await uploadPostImage({ name: "pic.png", type: "image/png" }, "user-1");

      expect(supabase.storage.from).toHaveBeenCalledWith("post-media");
      expect(upload.mock.calls[0][0]).toMatch(/^user-1\//);
      expect(url).toBe("https://cdn/post-media/user-1/x.jpg");
    });

    it("rejects without touching storage when no owner id is given", async () => {
      await expect(uploadPostImage({ name: "pic.png", type: "image/png" }, null)).rejects.toThrow("sign in");
      expect(supabase.storage.from).not.toHaveBeenCalled();
    });
  });

  describe("saved posts", () => {
    const postId = "11111111-1111-4111-8111-111111111111";

    it("getSavedPosts returns the flat list of saved post ids", async () => {
      const builder = { select: jest.fn(() => builder), eq: jest.fn(() => Promise.resolve({ data: [{ post_id: postId }], error: null })) };
      mockFrom.mockReturnValue(builder);

      await expect(getSavedPosts("user-1")).resolves.toEqual([postId]);
      expect(mockFrom).toHaveBeenCalledWith("saved_posts");
    });

    it("toggleSavedPost inserts (returns true) when not already saved", async () => {
      const readBuilder = { select: jest.fn(() => readBuilder), eq: jest.fn(() => readBuilder), maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) };
      const insertBuilder = { insert: jest.fn().mockResolvedValue({ error: null }) };
      mockFrom.mockReturnValueOnce(readBuilder).mockReturnValueOnce(insertBuilder);

      await expect(toggleSavedPost({ postId, userId: "user-1" })).resolves.toBe(true);
      expect(insertBuilder.insert).toHaveBeenCalledWith({ post_id: postId, user_id: "user-1" });
    });

    it("toggleSavedPost deletes (returns false) when already saved", async () => {
      const readBuilder = { select: jest.fn(() => readBuilder), eq: jest.fn(() => readBuilder), maybeSingle: jest.fn().mockResolvedValue({ data: { post_id: postId }, error: null }) };
      const deleteBuilder = { delete: jest.fn(() => deleteBuilder), eq: jest.fn(() => deleteBuilder), then: (resolve) => Promise.resolve({ error: null }).then(resolve) };
      mockFrom.mockReturnValueOnce(readBuilder).mockReturnValueOnce(deleteBuilder);

      await expect(toggleSavedPost({ postId, userId: "user-1" })).resolves.toBe(false);
    });

    it("toggleSavedPost rejects an invalid post id before ever calling supabase", async () => {
      await expect(toggleSavedPost({ postId: "not-a-uuid", userId: "user-1" })).rejects.toThrow(/Invalid post ID/);
      expect(mockFrom).not.toHaveBeenCalled();
    });
  });

  describe("suspension appeals", () => {
    it("submitSuspensionAppeal calls the RPC with the given reason", async () => {
      supabase.rpc.mockResolvedValue({ data: { id: "appeal-1", status: "pending" }, error: null });

      const result = await submitSuspensionAppeal("Please review, it was a mistake");

      expect(supabase.rpc).toHaveBeenCalledWith("submit_suspension_appeal", { p_reason: "Please review, it was a mistake" });
      expect(result.status).toBe("pending");
    });

    it("getMySuspensionAppeal returns null when the RPC returns no row", async () => {
      supabase.rpc.mockResolvedValue({ data: null, error: null });
      await expect(getMySuspensionAppeal()).resolves.toBeNull();
    });

    it("surfaces a clean message when appealing while not suspended", async () => {
      supabase.rpc.mockResolvedValue({ data: null, error: new Error("Only a suspended account can submit an appeal.") });
      await expect(submitSuspensionAppeal("why")).rejects.toThrow(/suspended account/);
    });
  });

  describe("admin: banned words + appeal review", () => {
    it("listBannedWords / addBannedWord / removeBannedWord", async () => {
      const builder = { select: jest.fn(() => builder), order: jest.fn(() => Promise.resolve({ data: [{ word: "spam" }], error: null })) };
      mockFrom.mockReturnValue(builder);
      await expect(listBannedWords()).resolves.toEqual([{ word: "spam" }]);

      supabase.rpc.mockResolvedValue({ data: null, error: null });
      await addBannedWord("newword");
      expect(supabase.rpc).toHaveBeenCalledWith("admin_add_banned_word", { p_word: "newword" });

      await removeBannedWord("spam");
      expect(supabase.rpc).toHaveBeenCalledWith("admin_remove_banned_word", { p_word: "spam" });
    });

    it("listSuspensionAppeals / resolveSuspensionAppeal", async () => {
      supabase.rpc.mockResolvedValue({ data: [{ id: "appeal-1", status: "pending" }], error: null });
      await expect(listSuspensionAppeals("pending")).resolves.toEqual([{ id: "appeal-1", status: "pending" }]);
      expect(supabase.rpc).toHaveBeenCalledWith("admin_list_suspension_appeals", { p_status: "pending" });

      supabase.rpc.mockResolvedValue({ data: { id: "appeal-1", status: "approved" }, error: null });
      await resolveSuspensionAppeal("appeal-1", "approved");
      expect(supabase.rpc).toHaveBeenCalledWith("resolve_suspension_appeal", {
        p_appeal_id: "appeal-1",
        p_decision: "approved",
        p_admin_note: null,
      });
    });
  });
});
