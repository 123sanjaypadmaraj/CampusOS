jest.mock("../lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import { supabase } from "../lib/supabase";
import {
  isPushSupported,
  subscribeToPush,
  getPushSubscriptionStatus,
  getNotificationCategoryPreferences,
  setNotificationCategoryPreference,
  getNotificationChannelPreferences,
  setNotificationChannelPreference,
  setQuietHours,
} from "./pushService";

describe("pushService", () => {
  const originalServiceWorker = navigator.serviceWorker;
  const originalNotification = window.Notification;
  const originalPushManager = window.PushManager;

  afterEach(() => {
    Object.defineProperty(navigator, "serviceWorker", { value: originalServiceWorker, configurable: true });
    window.Notification = originalNotification;
    window.PushManager = originalPushManager;
  });

  it("isPushSupported is false when serviceWorker/PushManager/Notification aren't all present", () => {
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    delete window.PushManager;
    delete window.Notification;

    expect(isPushSupported()).toBe(false);
  });

  it("isPushSupported is true when all three browser APIs are present", () => {
    Object.defineProperty(navigator, "serviceWorker", { value: {}, configurable: true });
    window.PushManager = function PushManager() {};
    window.Notification = function Notification() {};

    expect(isPushSupported()).toBe(true);
  });

  it("subscribeToPush rejects without a signed-in user", async () => {
    await expect(subscribeToPush(null)).rejects.toThrow("Sign in required");
  });

  it("subscribeToPush rejects when push isn't supported on this device", async () => {
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    delete window.PushManager;
    delete window.Notification;

    await expect(subscribeToPush("user-1")).rejects.toThrow("not supported");
  });

  it("getPushSubscriptionStatus reports 'unsupported' when push isn't available", async () => {
    Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    delete window.PushManager;
    delete window.Notification;

    expect(await getPushSubscriptionStatus()).toBe("unsupported");
  });

  it("getPushSubscriptionStatus reports 'denied' when notification permission was denied", async () => {
    Object.defineProperty(navigator, "serviceWorker", { value: { getRegistration: jest.fn() }, configurable: true });
    window.PushManager = function PushManager() {};
    window.Notification = { permission: "denied" };

    expect(await getPushSubscriptionStatus()).toBe("denied");
  });

  describe("notification category preferences", () => {
    afterEach(() => jest.clearAllMocks());

    it("getNotificationCategoryPreferences returns every category enabled with no signed-in user", async () => {
      const prefs = await getNotificationCategoryPreferences(null);
      expect(prefs.messages).toBe(true);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("getNotificationCategoryPreferences defaults every category to on when no row exists yet -- same fallback create_notification() itself uses", async () => {
      const maybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
      const eq = jest.fn(() => ({ maybeSingle }));
      const select = jest.fn(() => ({ eq }));
      supabase.from.mockReturnValue({ select });

      const prefs = await getNotificationCategoryPreferences("user-1");

      expect(supabase.from).toHaveBeenCalledWith("notification_preferences");
      expect(prefs.messages).toBe(true);
      expect(prefs.events).toBe(true);
    });

    it("getNotificationCategoryPreferences returns the stored row when one exists", async () => {
      const stored = { messages: false, events: true, clubs: true, community: true, services: true, marketplace: true, food: true, announcements: true };
      const maybeSingle = jest.fn().mockResolvedValue({ data: stored, error: null });
      const eq = jest.fn(() => ({ maybeSingle }));
      const select = jest.fn(() => ({ eq }));
      supabase.from.mockReturnValue({ select });

      expect(await getNotificationCategoryPreferences("user-1")).toEqual(stored);
    });

    it("setNotificationCategoryPreference upserts only the one changed column, scoped to the caller", async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      supabase.from.mockReturnValue({ upsert });

      await setNotificationCategoryPreference("user-1", "messages", false);

      expect(supabase.from).toHaveBeenCalledWith("notification_preferences");
      expect(upsert).toHaveBeenCalledWith({ user_id: "user-1", messages: false }, { onConflict: "user_id" });
    });

    it("setNotificationCategoryPreference rejects without a signed-in user", async () => {
      await expect(setNotificationCategoryPreference(null, "messages", false)).rejects.toThrow("Sign in required");
    });
  });

  describe("notification channel preferences", () => {
    afterEach(() => jest.clearAllMocks());

    it("getNotificationChannelPreferences defaults push on, email/sms off, with no signed-in user", async () => {
      const prefs = await getNotificationChannelPreferences(null);
      expect(prefs.channel_push).toBe(true);
      expect(prefs.channel_email).toBe(false);
      expect(prefs.channel_sms).toBe(false);
      expect(supabase.from).not.toHaveBeenCalled();
    });

    it("getNotificationChannelPreferences returns the stored row when one exists", async () => {
      const stored = {
        channel_push: true, channel_email: true, channel_sms: true,
        quiet_hours_enabled: true, quiet_hours_start: "23:00:00", quiet_hours_end: "06:00:00",
      };
      const maybeSingle = jest.fn().mockResolvedValue({ data: stored, error: null });
      const eq = jest.fn(() => ({ maybeSingle }));
      const select = jest.fn(() => ({ eq }));
      supabase.from.mockReturnValue({ select });

      expect(await getNotificationChannelPreferences("user-1")).toEqual(stored);
    });

    it("setNotificationChannelPreference upserts channel_sms scoped to the caller", async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      supabase.from.mockReturnValue({ upsert });

      await setNotificationChannelPreference("user-1", "channel_sms", true);

      expect(supabase.from).toHaveBeenCalledWith("notification_preferences");
      expect(upsert).toHaveBeenCalledWith({ user_id: "user-1", channel_sms: true }, { onConflict: "user_id" });
    });

    it("setNotificationChannelPreference rejects without a signed-in user", async () => {
      await expect(setNotificationChannelPreference(null, "channel_email", true)).rejects.toThrow("Sign in required");
    });

    it("setQuietHours upserts enabled + start/end together", async () => {
      const upsert = jest.fn().mockResolvedValue({ error: null });
      supabase.from.mockReturnValue({ upsert });

      await setQuietHours("user-1", { enabled: true, start: "22:30", end: "07:30" });

      expect(upsert).toHaveBeenCalledWith(
        { user_id: "user-1", quiet_hours_enabled: true, quiet_hours_start: "22:30", quiet_hours_end: "07:30" },
        { onConflict: "user_id" }
      );
    });

    it("setQuietHours rejects without a signed-in user", async () => {
      await expect(setQuietHours(null, { enabled: true })).rejects.toThrow("Sign in required");
    });
  });
});
