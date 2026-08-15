process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";

import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom";

const App = require("./App").default;

jest.mock("./services/mvpService", () => ({
  getDefaultCampus: jest.fn(() => Promise.resolve({ id: "campus-1" })),
  getCurrentUser: jest.fn(() => Promise.resolve(null)),
  getOrCreateProfile: jest.fn(() => Promise.resolve({ name: "Sanjay", usn: "", course: "Computer Science & Engineering", year: "2nd Year" })),
  getCampusPosts: jest.fn(() => Promise.resolve([])),
  getCampusEvents: jest.fn(() => Promise.resolve([])),
  getClubs: jest.fn(() => Promise.resolve([])),
  getCampusFood: jest.fn(() => Promise.resolve({ canteens: [], items: [] })),
  getUserNotifications: jest.fn(() => Promise.resolve([])),
  getMyOrders: jest.fn(() => Promise.resolve([])),
  createFoodOrder: jest.fn(() => Promise.resolve(null)),
  publishPost: jest.fn(() => Promise.resolve(null)),
  markAllNotificationsRead: jest.fn(() => Promise.resolve(null)),
  registerEvent: jest.fn(() => Promise.resolve(null)),
  signInWithGoogle: jest.fn(() => Promise.resolve(undefined)),
  connectGithub: jest.fn(() => Promise.resolve(undefined)),
  deriveGithubUrlFromIdentities: jest.fn(() => null),
  connectLinkedin: jest.fn(() => Promise.resolve(undefined)),
  markLinkedinVerified: jest.fn(() => Promise.resolve(null)),
  hasLinkedinIdentity: jest.fn(() => false),
  getMyVerification: jest.fn(() => Promise.resolve(null)),
  isValidPhone: jest.fn((value) => typeof value === "string" && /^\+?[0-9]{7,15}$/.test(value.trim())),
  sendMagicLink: jest.fn(() => Promise.resolve(true)),
  uploadPrintJob: jest.fn(() => Promise.resolve(null)),
  subscribeToAuthChanges: jest.fn((cb) => {
    // Save callback globally so signInWithPassword can trigger it
    global.mockAuthCallback = cb;
    return () => {};
  }),
  subscribeToUserNotifications: jest.fn(() => () => {}),
  subscribeToOrders: jest.fn(() => () => {}),
  subscribeToPosts: jest.fn(() => () => {}),
  subscribeToEvents: jest.fn(() => () => {}),
  subscribeToClubs: jest.fn(() => () => {}),
  subscribeToFood: jest.fn(() => () => {}),
  subscribeToMarketplace: jest.fn(() => () => {}),
  subscribeToLostFound: jest.fn(() => () => {}),
  togglePostLike: jest.fn(() => Promise.resolve(null)),
  getPostComments: jest.fn(() => Promise.resolve([])),
  addPostComment: jest.fn(() => Promise.resolve(null)),
  joinClub: jest.fn(() => Promise.resolve(null)),
  leaveClub: jest.fn(() => Promise.resolve(null)),
  getMyClubs: jest.fn(() => Promise.resolve([])),
  signOut: jest.fn(() => Promise.resolve(null)),
  getPeople: jest.fn(() => Promise.resolve([])),
  updateProfile: jest.fn(() => Promise.resolve(null)),
  getMyPrintJobs: jest.fn(() => Promise.resolve([])),
  getMyServiceRequests: jest.fn(() => Promise.resolve([])),
  getResources: jest.fn(() => Promise.resolve([])),
  getMyBookings: jest.fn(() => Promise.resolve([])),
  createCampusServiceRequest: jest.fn(() => Promise.resolve(null)),
  createResourceBooking: jest.fn(() => Promise.resolve(null)),
  getMyRegisteredEventIds: jest.fn(() => Promise.resolve([])),
  getSavedEvents: jest.fn(() => Promise.resolve([])),
  toggleSavedEvent: jest.fn(() => Promise.resolve(null)),
  cancelEventRegistration: jest.fn(() => Promise.resolve(null)),
  getLostFoundItems: jest.fn(() => Promise.resolve([])),
  createLostFoundItem: jest.fn(() => Promise.resolve(null)),
  claimLostFoundItem: jest.fn(() => Promise.resolve(null)),
  getMarketplaceListings: jest.fn(() => Promise.resolve([])),
  createMarketplaceListing: jest.fn(() => Promise.resolve(null)),
  markMarketplaceListingSold: jest.fn(() => Promise.resolve(null)),
  touchActivity: jest.fn(() => Promise.resolve()),
  triggerSosAlert: jest.fn(() => Promise.resolve({ id: "alert-1", status: "active", responders_notified: 0 })),
  cancelMySosAlert: jest.fn(() => Promise.resolve(null)),
  getBestEffortLocation: jest.fn(() => Promise.resolve(null)),
}));

describe("App button interactions", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    window.scrollTo = jest.fn();
  });

  test("renders Sign in and theme toggle buttons", async () => {
    render(<App />);
    expect(await screen.findByText(/Sign in/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/switch to dark mode/i)).toBeInTheDocument();
  });

  test("toggles theme mode when the theme button is clicked", async () => {
    render(<App />);
    const themeButton = await screen.findByLabelText(/switch to dark mode/i);

    fireEvent.click(themeButton);

    expect(screen.getByLabelText(/switch to light mode/i)).toBeInTheDocument();
    expect(window.localStorage.getItem("campus-theme")).toBe("dark");
  });

  test("opens the login modal and sends a magic link for an allowed college email", async () => {
    const { sendMagicLink } = require("./services/mvpService");
    render(<App />);
    fireEvent.click(await screen.findByTestId("sign-in-button"));

    const emailInput = await screen.findByPlaceholderText(/yourname@gmail.com/i);
    fireEvent.change(emailInput, { target: { value: "student@nhce.edu.in" } });
    fireEvent.click(await screen.findByTestId("direct-login-button"));

    await waitFor(() => {
      expect(sendMagicLink).toHaveBeenCalledWith("student@nhce.edu.in");
    });

    expect(await screen.findByText(/Check your email/i)).toBeInTheDocument();
  }, 10000);

  test("rejects an email outside the allowed college domains without calling the backend", async () => {
    const { sendMagicLink } = require("./services/mvpService");
    render(<App />);
    fireEvent.click(await screen.findByTestId("sign-in-button"));

    const emailInput = await screen.findByPlaceholderText(/yourname@gmail.com/i);
    fireEvent.change(emailInput, { target: { value: "someone@example.com" } });
    fireEvent.click(await screen.findByTestId("direct-login-button"));

    await waitFor(() => {
      expect(sendMagicLink).not.toHaveBeenCalled();
    });
  });

  test("navigates to the Campus section using the button", async () => {
    render(<App />);
    const campusButton = await screen.findByTestId("nav-campus-button");

    fireEvent.click(campusButton);

    expect(campusButton).toHaveClass("active");
  });

  describe("route branching (doc §76-78: one app, not separate per-role apps)", () => {
    afterEach(() => {
      window.history.pushState(null, "", "/");
    });

    test("clicking a nav item updates the URL, not just component state", async () => {
      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-events-button"));

      await waitFor(() => {
        expect(window.location.pathname).toBe("/events");
      });
    });

    test("deep-linking straight to a URL (refresh/bookmark) renders that section on first paint", async () => {
      window.history.pushState(null, "", "/food");
      const { container } = render(<App />);

      // Assert on the *route* rendering, not on its data finishing loading
      // (that's a separate, unrelated async chain with its own coverage) --
      // the Food section shows either its loading state or the loaded menu
      // depending on timing, both of which only render under `active ===
      // "food"`.
      await waitFor(() => {
        expect(container.querySelector(".food-page")).toBeInTheDocument();
      });
    });

    test("browser back navigates to the previous section", async () => {
      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-events-button"));
      await waitFor(() => expect(window.location.pathname).toBe("/events"));

      fireEvent.click(await screen.findByTestId("nav-home-button"));
      await waitFor(() => expect(window.location.pathname).toBe("/"));

      window.history.back();

      await waitFor(() => {
        expect(window.location.pathname).toBe("/events");
      });
    });

    test("an unknown path falls back to Home instead of a blank/broken screen", async () => {
      window.history.pushState(null, "", "/not-a-real-route");
      render(<App />);

      expect(await screen.findByText(/Sign in/i)).toBeInTheDocument();
    });

    test("a signed-out visitor deep-linking into /vendor is bounced back to Home, and the URL is corrected", async () => {
      window.history.pushState(null, "", "/vendor");
      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe("/");
      });
      expect(screen.queryByText(/Vendor access only/i)).not.toBeInTheDocument();
    });
  });

  test("starts Google OAuth sign-in from the login modal", async () => {
    const { signInWithGoogle } = require("./services/mvpService");
    render(<App />);
    fireEvent.click(await screen.findByTestId("sign-in-button"));

    fireEvent.click(await screen.findByRole("button", { name: /Continue with Google/i }));

    await waitFor(() => {
      expect(signInWithGoogle).toHaveBeenCalled();
    });
  });

  describe("event registration confirmation dialog", () => {
    const signInAs = (overrides = {}) => {
      const { getCurrentUser, getOrCreateProfile } = require("./services/mvpService");
      getCurrentUser.mockResolvedValueOnce({
        id: "user-1",
        email: "student@nhce.edu.in",
        user_metadata: {},
      });
      getOrCreateProfile.mockResolvedValueOnce({
        id: "user-1",
        name: "Sanjay",
        usn: "1NH21CS001",
        email: "student@nhce.edu.in",
        phone: null,
        ...overrides,
      });
    };

    test("prefills name/USN/email from the profile and submits the entered phone number", async () => {
      const { registerEvent } = require("./services/mvpService");
      registerEvent.mockResolvedValueOnce({ status: "confirmed", registration_id: "reg-1" });
      signInAs();

      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-events-button"));

      const registerButtons = await screen.findAllByRole("button", { name: "Register" });
      fireEvent.click(registerButtons[0]);

      expect(await screen.findByText(/Review your details/i)).toBeInTheDocument();
      expect(screen.getByDisplayValue("Sanjay")).toBeInTheDocument();
      expect(screen.getByDisplayValue("1NH21CS001")).toBeInTheDocument();
      expect(screen.getByDisplayValue("student@nhce.edu.in")).toBeInTheDocument();

      const phoneInput = screen.getByPlaceholderText(/9876543210/);
      fireEvent.change(phoneInput, { target: { value: "9876543210" } });
      fireEvent.click(screen.getByRole("button", { name: /Confirm registration/i }));

      await waitFor(() => {
        expect(registerEvent).toHaveBeenCalledWith({
          eventId: "00000000-0000-4000-a000-000000000001",
          userId: "user-1",
          contactPhone: "9876543210",
          contactName: "Sanjay",
          rollNumber: "",
          department: "",
        });
      });

      expect(await screen.findByText(/registration confirmed/i)).toBeInTheDocument();
    });

    test("lets the name be edited and submits roll number/department", async () => {
      const { registerEvent } = require("./services/mvpService");
      registerEvent.mockResolvedValueOnce({ status: "confirmed", registration_id: "reg-1" });
      signInAs();

      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-events-button"));

      const registerButtons = await screen.findAllByRole("button", { name: "Register" });
      fireEvent.click(registerButtons[0]);

      await screen.findByText(/Review your details/i);
      fireEvent.change(screen.getByDisplayValue("Sanjay"), { target: { value: "Sanjay P" } });
      fireEvent.change(screen.getByPlaceholderText(/9876543210/), { target: { value: "9876543210" } });
      fireEvent.change(screen.getByPlaceholderText(/Optional$/), { target: { value: "42" } }); // roll number
      fireEvent.change(screen.getByPlaceholderText(/Computer Science/), { target: { value: "CSE" } }); // department
      fireEvent.click(screen.getByRole("button", { name: /Confirm registration/i }));

      await waitFor(() => {
        expect(registerEvent).toHaveBeenCalledWith({
          eventId: "00000000-0000-4000-a000-000000000001",
          userId: "user-1",
          contactPhone: "9876543210",
          contactName: "Sanjay P",
          rollNumber: "42",
          department: "CSE",
        });
      });
    });

    test("blocks confirmation and never calls registerEvent when the phone number is missing", async () => {
      const { registerEvent } = require("./services/mvpService");
      signInAs();

      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-events-button"));

      const registerButtons = await screen.findAllByRole("button", { name: "Register" });
      fireEvent.click(registerButtons[0]);

      await screen.findByText(/Review your details/i);
      fireEvent.click(screen.getByRole("button", { name: /Confirm registration/i }));

      expect(await screen.findByText(/valid phone number/i)).toBeInTheDocument();
      expect(registerEvent).not.toHaveBeenCalled();
    });

    test("closing the dialog does not register the user", async () => {
      const { registerEvent } = require("./services/mvpService");
      signInAs();

      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-events-button"));

      const registerButtons = await screen.findAllByRole("button", { name: "Register" });
      fireEvent.click(registerButtons[0]);

      await screen.findByText(/Review your details/i);
      fireEvent.click(document.querySelector(".modal-close"));

      await waitFor(() => {
        expect(screen.queryByText(/Review your details/i)).not.toBeInTheDocument();
      });
      expect(registerEvent).not.toHaveBeenCalled();
    });
  });

  describe("SOS / emergency alert", () => {
    const signInAs = (overrides = {}) => {
      const { getCurrentUser, getOrCreateProfile } = require("./services/mvpService");
      getCurrentUser.mockResolvedValueOnce({ id: "user-1", email: "student@nhce.edu.in", user_metadata: {} });
      getOrCreateProfile.mockResolvedValueOnce({
        id: "user-1", name: "Sanjay", usn: "1NH21CS001", email: "student@nhce.edu.in", phone: null, ...overrides,
      });
    };

    const openSosModal = async () => {
      render(<App />);
      fireEvent.click(await screen.findByTestId("nav-services-button"));
      fireEvent.click(await screen.findByRole("button", { name: /Emergency/i }));
      await screen.findByText(/Hold for emergency/i);
    };

    test("the Emergency service card actually opens the SOS modal (used to be a dead stub)", async () => {
      await openSosModal();
      expect(screen.getByRole("button", { name: /Hold to activate SOS/i })).toBeInTheDocument();
    });

    test("a quick-action button prompts sign-in instead of dispatching when signed out", async () => {
      const { triggerSosAlert } = require("./services/mvpService");
      await openSosModal();

      fireEvent.click(screen.getByRole("button", { name: /^Security$/i }));

      await screen.findByText(/Sign in to send an SOS alert/i);
      expect(triggerSosAlert).not.toHaveBeenCalled();
    });

    test("releasing the hold button before the threshold cancels -- no alert is sent", async () => {
      const { triggerSosAlert } = require("./services/mvpService");
      signInAs();
      await openSosModal();

      const holdBtn = screen.getByRole("button", { name: /Hold to activate SOS/i });
      fireEvent.pointerDown(holdBtn);
      fireEvent.pointerUp(holdBtn);

      // Give any (incorrectly still-pending) timer a chance to fire.
      await new Promise((r) => setTimeout(r, 50));
      expect(triggerSosAlert).not.toHaveBeenCalled();
    });

    test("holding past the threshold sends a real general alert with best-effort location", async () => {
      const { triggerSosAlert, getBestEffortLocation } = require("./services/mvpService");
      getBestEffortLocation.mockResolvedValueOnce({ latitude: 12.9, longitude: 77.6, accuracy: 15 });
      signInAs();
      await openSosModal();

      jest.useFakeTimers({ advanceTimers: true });
      try {
        const holdBtn = screen.getByRole("button", { name: /Hold to activate SOS/i });
        fireEvent.pointerDown(holdBtn);
        jest.advanceTimersByTime(1600);

        await waitFor(() => {
          expect(triggerSosAlert).toHaveBeenCalledWith({
            alertType: "general",
            location: { latitude: 12.9, longitude: 77.6, accuracy: 15 },
          });
        });
        await screen.findByText("Alert sent");
      } finally {
        jest.useRealTimers();
      }
    });

    test("a quick-action button (e.g. Medical) dispatches immediately without holding", async () => {
      const { triggerSosAlert } = require("./services/mvpService");
      signInAs();
      await openSosModal();

      fireEvent.click(screen.getByRole("button", { name: /^Medical$/i }));

      await waitFor(() => {
        expect(triggerSosAlert).toHaveBeenCalledWith(expect.objectContaining({ alertType: "medical" }));
      });
      await screen.findByText("Alert sent");
    });

    test("cancelling a just-sent alert calls cancelMySosAlert and returns to the trigger screen", async () => {
      const { triggerSosAlert, cancelMySosAlert } = require("./services/mvpService");
      triggerSosAlert.mockResolvedValueOnce({ id: "alert-42", status: "active", responders_notified: 2 });
      signInAs();
      await openSosModal();

      fireEvent.click(screen.getByRole("button", { name: /^Campus help$/i }));
      await screen.findByText("Alert sent");

      fireEvent.click(screen.getByRole("button", { name: /false alarm/i }));

      await waitFor(() => {
        expect(cancelMySosAlert).toHaveBeenCalledWith("alert-42");
      });
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /Hold to activate SOS/i })).toBeInTheDocument();
      });
    });
  });

  describe("vendor account nav (a purpose-built ordering console, not the full student app)", () => {
    afterEach(() => {
      window.history.pushState(null, "", "/");
    });

    const signInAsVendor = () => {
      const { getCurrentUser, getOrCreateProfile } = require("./services/mvpService");
      getCurrentUser.mockResolvedValueOnce({
        id: "vendor-1",
        email: "udupi.canteen@nhce.edu.in",
        user_metadata: {},
      });
      getOrCreateProfile.mockResolvedValueOnce({
        id: "vendor-1",
        name: "Udupi Canteen",
        role: "vendor",
        email: "udupi.canteen@nhce.edu.in",
      });
    };

    test("bottom nav shows only Dashboard + Profile, not the student sections", async () => {
      signInAsVendor();
      render(<App />);

      await screen.findByTestId("nav-vendor-button");

      expect(screen.getByTestId("nav-profile-button")).toBeInTheDocument();
      for (const key of ["home", "campus", "events", "services", "socialize", "messages"]) {
        expect(screen.queryByTestId(`nav-${key}-button`)).not.toBeInTheDocument();
      }
    });

    test("the global search icon is hidden for a vendor account", async () => {
      signInAsVendor();
      render(<App />);

      await screen.findByTestId("nav-vendor-button");
      expect(screen.queryByTestId("global-search-button")).not.toBeInTheDocument();
    });

    test("a vendor deep-linking into a student route (/events) is bounced to their own dashboard", async () => {
      signInAsVendor();
      window.history.pushState(null, "", "/events");
      render(<App />);

      await waitFor(() => {
        expect(window.location.pathname).toBe("/vendor");
      });
    });
  });
});
