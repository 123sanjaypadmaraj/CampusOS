jest.mock("../lib/supabase", () => ({
  supabase: { from: jest.fn() },
}));

import {
  isPushSupported,
  subscribeToPush,
  getPushSubscriptionStatus,
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
});
