import { act, renderHook } from "@testing-library/react";
import { useIsMobile } from "./useIsMobile";

describe("useIsMobile", () => {
  const original = window.matchMedia;
  afterEach(() => {
    window.matchMedia = original;
  });

  it("is false when matchMedia is unavailable (jsdom default)", () => {
    window.matchMedia = undefined;
    expect(renderHook(() => useIsMobile()).result.current).toBe(false);
  });

  it("does not crash on a bare { matches } double without addEventListener", () => {
    window.matchMedia = jest.fn().mockReturnValue({ matches: true });
    expect(renderHook(() => useIsMobile()).result.current).toBe(true);
  });

  it("follows viewport changes", () => {
    let listener;
    const query = {
      matches: false,
      addEventListener: (_, cb) => { listener = cb; },
      removeEventListener: jest.fn(),
    };
    window.matchMedia = jest.fn().mockReturnValue(query);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
    act(() => {
      query.matches = true;
      listener();
    });
    expect(result.current).toBe(true);
  });
});
