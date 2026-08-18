jest.mock("../lib/supabase", () => ({
  supabase: {
    rpc: jest.fn(),
    functions: { invoke: jest.fn() },
  },
}));

import { supabase } from "../lib/supabase";
import {
  requestContactEmailVerification,
  confirmContactEmailVerification,
  requestPasswordReset,
  confirmPasswordReset,
} from "./contactService";

describe("contactService", () => {
  afterEach(() => jest.clearAllMocks());

  describe("requestContactEmailVerification", () => {
    it("calls the RPC with the given email", async () => {
      supabase.rpc.mockResolvedValue({ error: null });
      await requestContactEmailVerification("me@example.com");
      expect(supabase.rpc).toHaveBeenCalledWith("request_contact_email_verification", { p_email: "me@example.com" });
    });

    it("throws the server's error message", async () => {
      supabase.rpc.mockResolvedValue({ error: { message: "Too many verification emails requested. Try again later." } });
      await expect(requestContactEmailVerification("me@example.com")).rejects.toThrow("Too many verification emails");
    });
  });

  describe("confirmContactEmailVerification", () => {
    it("calls the RPC with the token", async () => {
      supabase.rpc.mockResolvedValue({ error: null });
      await confirmContactEmailVerification("raw-token");
      expect(supabase.rpc).toHaveBeenCalledWith("confirm_contact_email_verification", { p_token: "raw-token" });
    });

    it("throws a fallback message when the server gives none", async () => {
      supabase.rpc.mockResolvedValue({ error: {} });
      await expect(confirmContactEmailVerification("bad-token")).rejects.toThrow("invalid or has expired");
    });
  });

  describe("requestPasswordReset", () => {
    it("invokes the edge function with the USN", async () => {
      supabase.functions.invoke.mockResolvedValue({ data: { ok: true, message: "generic" }, error: null });
      const result = await requestPasswordReset("1NH25CS265");
      expect(supabase.functions.invoke).toHaveBeenCalledWith("request-password-reset", { body: { usn: "1NH25CS265" } });
      expect(result.ok).toBe(true);
    });

    it("surfaces a validation error from the function body", async () => {
      const context = { json: async () => ({ code: "USN_INVALID", message: "USN must be exactly 10 letters/numbers." }) };
      supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: "FunctionsHttpError", context } });
      await expect(requestPasswordReset("bad")).rejects.toThrow("USN must be exactly 10 letters/numbers.");
    });
  });

  describe("confirmPasswordReset", () => {
    it("invokes the edge function with token + new password", async () => {
      supabase.functions.invoke.mockResolvedValue({ data: { ok: true }, error: null });
      await confirmPasswordReset("raw-token", "newpassword123");
      expect(supabase.functions.invoke).toHaveBeenCalledWith("confirm-password-reset", {
        body: { token: "raw-token", newPassword: "newpassword123" },
      });
    });

    it("surfaces an invalid-token error from the function body", async () => {
      const context = { json: async () => ({ code: "INVALID_TOKEN", message: "This reset link is invalid or has expired." }) };
      supabase.functions.invoke.mockResolvedValue({ data: null, error: { message: "FunctionsHttpError", context } });
      await expect(confirmPasswordReset("bad-token", "newpassword123")).rejects.toThrow("invalid or has expired");
    });
  });
});
