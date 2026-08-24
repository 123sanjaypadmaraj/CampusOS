import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";

import { useModalA11y } from "./useModalA11y";

function Dialog({ onClose }) {
  const dialogRef = useModalA11y(onClose);
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} data-testid="dialog">
      <button data-testid="first">First</button>
      <button data-testid="second">Second</button>
      <button data-testid="last">Last</button>
    </div>
  );
}

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && <Dialog onClose={() => setOpen(false)} />}
    </div>
  );
}

describe("useModalA11y", () => {
  test("moves focus to the first focusable element on mount", () => {
    render(<Dialog onClose={jest.fn()} />);
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  test("Escape calls onClose", () => {
    const onClose = jest.fn();
    render(<Dialog onClose={onClose} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("Tab from the last element wraps to the first, trapping focus inside the dialog", () => {
    render(<Dialog onClose={jest.fn()} />);
    screen.getByTestId("last").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByTestId("first")).toHaveFocus();
  });

  test("Shift+Tab from the first element wraps to the last", () => {
    render(<Dialog onClose={jest.fn()} />);
    screen.getByTestId("first").focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(screen.getByTestId("last")).toHaveFocus();
  });

  test("restores focus to the trigger element once the dialog unmounts", () => {
    render(<Harness />);
    const trigger = screen.getByTestId("trigger");
    trigger.focus();
    fireEvent.click(trigger);
    expect(screen.getByTestId("first")).toHaveFocus();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(trigger).toHaveFocus();
  });
});
