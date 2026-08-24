import { renderHook, act } from "@testing-library/react";

import { useInstallPrompt } from "./useInstallPrompt";

function fireBeforeInstallPrompt(overrides = {}) {
  const event = new Event("beforeinstallprompt", { cancelable: true });
  event.prompt = jest.fn();
  event.userChoice = Promise.resolve({ outcome: "accepted" });
  Object.assign(event, overrides);
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

describe("useInstallPrompt", () => {
  beforeEach(() => {
    localStorage.clear();
    // jsdom's matchMedia isn't implemented by default.
    window.matchMedia = jest.fn().mockReturnValue({ matches: false });
    delete window.navigator.standalone;
  });

  test("starts with canInstall false until the browser fires beforeinstallprompt", () => {
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.canInstall).toBe(false);
    expect(result.current.installed).toBe(false);
  });

  test("canInstall flips true once beforeinstallprompt fires, and prompting resolves the browser's choice", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = fireBeforeInstallPrompt();

    expect(result.current.canInstall).toBe(true);

    let outcome;
    await act(async () => {
      outcome = await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalled();
    expect(outcome).toBe("accepted");
    // The captured event is single-use -- consumed after prompting.
    expect(result.current.canInstall).toBe(false);
  });

  test("appinstalled marks the app installed and clears the prompt", () => {
    const { result } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(true);

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.installed).toBe(true);
    expect(result.current.canInstall).toBe(false);
  });

  test("dismiss hides the banner immediately and is remembered across a remount", () => {
    const { result, rerender } = renderHook(() => useInstallPrompt());
    fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(true);

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.canInstall).toBe(false);

    rerender();
    fireBeforeInstallPrompt();
    // Snoozed by the recent dismissal even though the browser re-offered the prompt.
    expect(result.current.canInstall).toBe(false);
  });

  test("never offers to install when already running standalone", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    const { result } = renderHook(() => useInstallPrompt());
    expect(result.current.installed).toBe(true);

    fireBeforeInstallPrompt();
    expect(result.current.canInstall).toBe(false);
  });
});
