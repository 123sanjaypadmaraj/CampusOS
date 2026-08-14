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
});
