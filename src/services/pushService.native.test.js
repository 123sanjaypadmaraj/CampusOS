// Native (Capacitor) push paths -- kept in a separate file from
// pushService.test.js because IS_NATIVE/PLATFORM are computed once at
// module load from Capacitor.isNativePlatform()/getPlatform(), so getting
// the "native" branches under test means mocking @capacitor/core and
// @capacitor/push-notifications *before* pushService.js is first required
// -- doing that in the same file as the web-path tests would mean every
// test in the file runs against a mocked-native module instead of the real
// jsdom (web) environment those tests rely on.

jest.mock("../lib/supabase", () => ({ supabase: { from: jest.fn() } }));

jest.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => "android",
  },
}));

const mockCheckPermissions = jest.fn();
const mockRequestPermissions = jest.fn();
const mockRegister = jest.fn();
const mockAddListener = jest.fn();

jest.mock("@capacitor/push-notifications", () => ({
  PushNotifications: {
    checkPermissions: (...args) => mockCheckPermissions(...args),
    requestPermissions: (...args) => mockRequestPermissions(...args),
    register: (...args) => mockRegister(...args),
    addListener: (...args) => mockAddListener(...args),
  },
}));

const { supabase } = require("../lib/supabase");
const {
  isPushSupported,
  subscribeToPush,
  unsubscribeFromPush,
  getPushSubscriptionStatus,
  registerNativePushListeners,
} = require("./pushService");

// Table-scoped Supabase mocks -- each test wires only the table(s) it needs.
function mockSupabaseTable(responsesByTable) {
  supabase.from.mockImplementation((table) => responsesByTable[table]());
}

describe("pushService (native/Capacitor)", () => {
  let registrationCallback;
  let registrationErrorCallback;
  const removeHandle = { remove: jest.fn() };

  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
    registrationCallback = undefined;
    registrationErrorCallback = undefined;

    mockAddListener.mockImplementation((event, cb) => {
      if (event === "registration") registrationCallback = cb;
      if (event === "registrationError") registrationErrorCallback = cb;
      return Promise.resolve({ ...removeHandle });
    });
  });

  it("isPushSupported is unconditionally true on native", () => {
    expect(isPushSupported()).toBe(true);
  });

  it("getPushSubscriptionStatus is 'denied' when the OS permission was denied", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "denied" });
    expect(await getPushSubscriptionStatus()).toBe("denied");
  });

  it("getPushSubscriptionStatus is 'not-subscribed' when granted but no token stored yet", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    expect(await getPushSubscriptionStatus()).toBe("not-subscribed");
  });

  it("getPushSubscriptionStatus is 'subscribed' once a native token was saved locally", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    localStorage.setItem("campusos-native-push-token", "abc-token");
    expect(await getPushSubscriptionStatus()).toBe("subscribed");
  });

  it("subscribeToPush registers, saves the FCM/APNs token with platform, and turns channel_push on", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    mockRegister.mockImplementation(() => {
      Promise.resolve().then(() => registrationCallback({ value: "native-token-123" }));
    });

    const pushUpsert = jest.fn().mockResolvedValue({ error: null });
    const prefUpsert = jest.fn().mockResolvedValue({ error: null });
    mockSupabaseTable({
      push_subscriptions: () => ({ upsert: pushUpsert }),
      notification_preferences: () => ({ upsert: prefUpsert }),
    });

    const result = await subscribeToPush("user-1");

    expect(result).toBe("native-token-123");
    expect(pushUpsert).toHaveBeenCalledWith(
      {
        user_id: "user-1",
        endpoint: "native-token-123",
        keys: null,
        platform: "android",
        device_label: "CampusOS android app",
      },
      { onConflict: "endpoint" }
    );
    expect(prefUpsert).toHaveBeenCalledWith({ user_id: "user-1", channel_push: true }, { onConflict: "user_id" });
    expect(localStorage.getItem("campusos-native-push-token")).toBe("native-token-123");
  });

  it("subscribeToPush prompts for permission when not yet decided, and rejects if the user declines", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "prompt" });
    mockRequestPermissions.mockResolvedValue({ receive: "denied" });

    await expect(subscribeToPush("user-1")).rejects.toThrow("Notification permission was not granted");
    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(mockRegister).not.toHaveBeenCalled();
  });

  it("subscribeToPush rejects when native registration itself fails", async () => {
    mockCheckPermissions.mockResolvedValue({ receive: "granted" });
    mockRegister.mockImplementation(() => {
      Promise.resolve().then(() => registrationErrorCallback({ error: "no Firebase config" }));
    });

    await expect(subscribeToPush("user-1")).rejects.toThrow("no Firebase config");
  });

  it("unsubscribeFromPush deletes the stored token's row and clears local state", async () => {
    localStorage.setItem("campusos-native-push-token", "native-token-123");

    const eq = jest.fn().mockResolvedValue({ error: null });
    const del = jest.fn(() => ({ eq }));
    const prefUpsert = jest.fn().mockResolvedValue({ error: null });
    mockSupabaseTable({
      push_subscriptions: () => ({ delete: del }),
      notification_preferences: () => ({ upsert: prefUpsert }),
    });

    await unsubscribeFromPush("user-1");

    expect(del).toHaveBeenCalled();
    expect(eq).toHaveBeenCalledWith("endpoint", "native-token-123");
    expect(localStorage.getItem("campusos-native-push-token")).toBeNull();
    expect(prefUpsert).toHaveBeenCalledWith({ user_id: "user-1", channel_push: false }, { onConflict: "user_id" });
  });

  it("unsubscribeFromPush is a no-op (besides the preference flip) when there's no stored token", async () => {
    const del = jest.fn();
    const prefUpsert = jest.fn().mockResolvedValue({ error: null });
    mockSupabaseTable({
      push_subscriptions: () => ({ delete: del }),
      notification_preferences: () => ({ upsert: prefUpsert }),
    });

    await unsubscribeFromPush("user-1");

    expect(del).not.toHaveBeenCalled();
  });

  describe("registerNativePushListeners", () => {
    it("routes a tapped notification's actionType/actionId through onNotificationTapped", async () => {
      let actionCallback;
      mockAddListener.mockImplementation((event, cb) => {
        if (event === "pushNotificationActionPerformed") actionCallback = cb;
        return Promise.resolve({ ...removeHandle });
      });

      const onNotificationTapped = jest.fn();
      registerNativePushListeners({ onNotificationTapped });
      // addListener resolves are queued microtasks -- let them settle.
      await Promise.resolve();
      await Promise.resolve();

      actionCallback({ notification: { data: { actionType: "conversation", actionId: "convo-9" } } });

      expect(onNotificationTapped).toHaveBeenCalledWith("conversation", "convo-9");
    });

    it("surfaces a foreground push as an in-app toast via notify()", async () => {
      let receivedCallback;
      mockAddListener.mockImplementation((event, cb) => {
        if (event === "pushNotificationReceived") receivedCallback = cb;
        return Promise.resolve({ ...removeHandle });
      });

      const notify = jest.fn();
      registerNativePushListeners({ notify });
      await Promise.resolve();
      await Promise.resolve();

      receivedCallback({ title: "New message", body: "Hey!" });

      expect(notify).toHaveBeenCalledWith("New message");
    });

    it("the returned cleanup function removes both listener handles", async () => {
      const cleanup = registerNativePushListeners({});
      await Promise.resolve();
      await Promise.resolve();

      cleanup();

      expect(removeHandle.remove).toHaveBeenCalled();
    });
  });
});
