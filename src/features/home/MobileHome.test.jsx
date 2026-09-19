import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { MobileHome, greeting } from "./MobileHome";

jest.mock("./Home", () => ({
  RemindersWidget: () => null,
  RecommendedForYou: () => null,
}));

const events = [
  { id: "e1", date: "12", month: "AUG", title: "Generative AI Workshop", club: "AI Club", time: "2:00 PM", place: "Seminar Hall 2" },
];

const setup = (props = {}) => {
  const handlers = { go: jest.fn(), openSearch: jest.fn(), openSos: jest.fn(), notify: jest.fn() };
  render(<MobileHome authUser={null} profile={{ name: "Asha Rao" }} events={events} {...handlers} {...props} />);
  return handlers;
};

describe("MobileHome", () => {
  it("greets by first name and lists real events in the rail", () => {
    setup();
    expect(screen.getByText(/, Asha$/)).toBeInTheDocument();
    expect(screen.getByText("Generative AI Workshop")).toBeInTheDocument();
  });

  it("routes tiles through go()", () => {
    const { go } = setup();
    fireEvent.click(screen.getByRole("button", { name: "Print" }));
    expect(go).toHaveBeenCalledWith("print");
  });

  it("opens search and SOS from the header controls", () => {
    const { openSearch, openSos } = setup();
    fireEvent.click(screen.getByRole("button", { name: /search events, clubs/i }));
    fireEvent.click(screen.getByRole("button", { name: /need help right now/i }));
    expect(openSearch).toHaveBeenCalledTimes(1);
    expect(openSos).toHaveBeenCalledTimes(1);
  });

  it("hides the event rail when there are no events", () => {
    setup({ events: [] });
    expect(screen.queryByText("Happening on campus")).not.toBeInTheDocument();
  });

  it("greeting follows the time of day", () => {
    expect(greeting(new Date(2026, 0, 1, 8))).toBe("Good morning");
    expect(greeting(new Date(2026, 0, 1, 14))).toBe("Good afternoon");
    expect(greeting(new Date(2026, 0, 1, 20))).toBe("Good evening");
  });
});
