process.env.VITE_SUPABASE_URL = "https://test.supabase.co";
process.env.VITE_SUPABASE_PUBLISHABLE_KEY = "test-key";
process.env.VITE_DEV_EMAIL = "sanjaypadmaraj@nhce.edu.in";
process.env.VITE_DEV_PASSWORD = "test-password";

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
  sendMagicLink: jest.fn(() => Promise.resolve(true)),
  uploadPrintJob: jest.fn(() => Promise.resolve(null)),
  subscribeToAuthChanges: jest.fn((cb) => {
    // Save callback globally so signInWithPassword can trigger it
    global.mockAuthCallback = cb;
    return () => {};
  }),
  signInWithPassword: jest.fn(() => {
    if (global.mockAuthCallback) {
      global.mockAuthCallback({ session: {}, user: { name: "Sanjay", id: "1" } });
    }
    return Promise.resolve({ session: {}, user: { name: "Sanjay" } });
  }),
  subscribeToUserNotifications: jest.fn(() => () => {}),
  subscribeToOrders: jest.fn(() => () => {}),
  subscribeToPosts: jest.fn(() => () => {}),
  subscribeToEvents: jest.fn(() => () => {}),
  subscribeToClubs: jest.fn(() => () => {}),
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

  test("opens the login modal and logs in directly with the default NHCE email", async () => {
    render(<App />);
    fireEvent.click(await screen.findByTestId("sign-in-button"));

    // Click the submit button inside the modal
    fireEvent.click(await screen.findByTestId("direct-login-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("sign-in-button")).not.toBeInTheDocument();
    });

    expect(screen.getAllByText(/Sanjay/i).length).toBeGreaterThan(0);
  }, 10000);

  test("navigates to the Campus section using the button", async () => {
    render(<App />);
    const campusButton = await screen.findByTestId("nav-campus-button");

    fireEvent.click(campusButton);

    expect(campusButton).toHaveClass("active");
  });
});
