/**
 * Drives the real Event Manager UI against a mocked data layer: what the
 * organizer sees and can do. Server-side rules (authorization, merge-on-
 * reimport, ticket sync) live in 20260919000100_event_participants_teams.sql
 * and are not re-implemented here.
 */
import React from "react";
import { render, screen, waitFor, within, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom";

jest.mock("./api", () => ({
  syncEventParticipants: jest.fn(),
  listEventParticipants: jest.fn(),
  listEventTeams: jest.fn(),
  importEventParticipants: jest.fn(),
  saveEventParticipant: jest.fn(),
  deleteEventParticipants: jest.fn(),
  setParticipantsAttendance: jest.fn(),
  createEventTeams: jest.fn(),
  updateEventTeam: jest.fn(),
  deleteEventTeam: jest.fn(),
  assignParticipantsToTeams: jest.fn(),
  describeEventManagerError: (e) => (e && e.message) || "Something went wrong",
}));
jest.mock("../../utils/csv", () => ({ downloadCsv: jest.fn() }));

import * as api from "./api";
import { downloadCsv } from "../../utils/csv";
import EventWorkspace from "./EventWorkspace";

const person = (over) => ({
  id: "p1", event_id: "ev1", name: "Asha Rao", usn: "1NH21CS001", email: "asha@x.com", phone: "999",
  department: "CSE", year: "3", team_id: null, source: "import", status: "registered",
  attended: false, attended_at: null, notes: null, extra: { Track: "AI" }, ...over,
});

const event = { id: "ev1", title: "Hack Day" };
let notify;

function setup({ participants = [person(), person({ id: "p2", name: "Ravi K", usn: "1NH21EC002", email: "ravi@x.com", department: "ECE" })], teams = [] } = {}) {
  api.syncEventParticipants.mockResolvedValue({ added: 0, linked: 0 });
  api.listEventParticipants.mockResolvedValue(participants);
  api.listEventTeams.mockResolvedValue(teams);
  notify = jest.fn();
  return render(<EventWorkspace event={event} onClose={() => {}} notify={notify} />);
}

beforeEach(() => jest.clearAllMocks());

describe("EventWorkspace", () => {
  it("syncs in-app registrations, then lists everyone with a summary", async () => {
    setup();
    expect(await screen.findByText("Asha Rao")).toBeInTheDocument();
    expect(api.syncEventParticipants).toHaveBeenCalledWith("ev1");
    expect(screen.getByText("Ravi K")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Participants \(2\)/ })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: /Attendance \(0\/2\)/ })).toBeInTheDocument();
  });

  it("shows a clear message when the migration hasn't been applied yet", async () => {
    api.syncEventParticipants.mockRejectedValue(Object.assign(new Error("function not found"), { code: "PGRST202" }));
    render(<EventWorkspace event={event} onClose={() => {}} notify={jest.fn()} />);
    expect(await screen.findByText(/isn't set up on this database yet/i)).toBeInTheDocument();
  });

  it("searches across form answers", async () => {
    setup();
    await screen.findByText("Asha Rao");
    fireEvent.change(screen.getByLabelText("Search participants"), { target: { value: "1nh21ec" } });
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    expect(screen.getByText("Ravi K")).toBeInTheDocument();
  });

  it("marks someone present immediately and calls the server", async () => {
    api.setParticipantsAttendance.mockResolvedValue(1);
    setup();
    await screen.findByText("Asha Rao");
    const row = screen.getByText("Asha Rao").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: /mark present/i }));
    expect(within(row).getByRole("button", { name: /^present$/i })).toBeInTheDocument();
    expect(api.setParticipantsAttendance).toHaveBeenCalledWith("ev1", ["p1"], true);
  });

  it("rolls the toggle back and says why when the server rejects it", async () => {
    api.setParticipantsAttendance.mockRejectedValue(new Error("Not authorized to manage this event"));
    setup();
    await screen.findByText("Asha Rao");
    const row = screen.getByText("Asha Rao").closest("tr");
    fireEvent.click(within(row).getByRole("button", { name: /mark present/i }));
    await waitFor(() => expect(notify).toHaveBeenCalledWith("Not authorized to manage this event"));
    expect(within(screen.getByText("Asha Rao").closest("tr")).getByRole("button", { name: /mark present/i })).toBeInTheDocument();
  });

  it("bulk-assigns the selected rows to a team", async () => {
    api.assignParticipantsToTeams.mockResolvedValue(2);
    setup({ teams: [{ id: "t1", event_id: "ev1", name: "Alpha", notes: null }] });
    await screen.findByText("Asha Rao");
    fireEvent.click(screen.getByLabelText("Select all shown"));
    fireEvent.change(screen.getByLabelText("Assign selected to team"), { target: { value: "t1" } });
    fireEvent.click(screen.getByRole("button", { name: "Apply team" }));
    expect(api.assignParticipantsToTeams).toHaveBeenCalledWith("ev1", expect.arrayContaining([
      { participant_id: "p1", team_id: "t1" }, { participant_id: "p2", team_id: "t1" },
    ]));
  });

  it("exports the filtered table including form-answer columns", async () => {
    setup();
    await screen.findByText("Asha Rao");
    fireEvent.click(screen.getByRole("button", { name: /Export CSV \(2\)/ }));
    const [filename, header, rows] = downloadCsv.mock.calls[0];
    expect(filename).toBe("Hack_Day-participants.csv");
    expect(header).toContain("Track");
    expect(rows).toHaveLength(2);
  });

  it("imports a pasted Google Forms sheet: auto-matches columns, keeps other answers, reports the result", async () => {
    api.importEventParticipants.mockResolvedValue({ inserted: 2, updated: 0, skipped: 0, teams_created: 1 });
    setup({ participants: [], teams: [] });
    fireEvent.click(await screen.findByRole("tab", { name: "Import" }));

    const csv = 'Timestamp,Full Name,Email Address,USN,Team Name,Why join?\n"t1",Meera,m@x.com,1NH21IS003,Rockets,"To learn, and build"\n"t2",Dev,d@x.com,1NH21IS004,Rockets,Fun';
    fireEvent.change(screen.getByPlaceholderText(/Name,Email,USN/), { target: { value: csv } });

    expect(await screen.findByText(/2 rows found/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Import 2 rows" }));

    await waitFor(() => expect(api.importEventParticipants).toHaveBeenCalledTimes(1));
    const [eventId, rows] = api.importEventParticipants.mock.calls[0];
    expect(eventId).toBe("ev1");
    expect(rows[0]).toMatchObject({ name: "Meera", email: "m@x.com", usn: "1NH21IS003", team: "Rockets" });
    expect(rows[0].extra).toEqual({ Timestamp: "t1", "Why join?": "To learn, and build" });
    expect(await screen.findByText(/2 added/)).toBeInTheDocument();
    expect(screen.getByText(/1 team created/)).toBeInTheDocument();
  });

  it("refuses to import when no name / email / USN column is matched", async () => {
    setup({ participants: [], teams: [] });
    fireEvent.click(await screen.findByRole("tab", { name: "Import" }));
    fireEvent.change(screen.getByPlaceholderText(/Name,Email,USN/), { target: { value: "Colour,Size\nred,L" } });
    expect(await screen.findByText(/Match at least Name, Email or USN/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Import 1 row$/ })).toBeDisabled();
  });

  it("previews a team split and applies it: creates the teams, then assigns everyone", async () => {
    api.createEventTeams.mockImplementation(async (_e, names) => names.map((n, i) => ({ id: `t${i}`, name: n })));
    api.assignParticipantsToTeams.mockResolvedValue(2);
    setup({ participants: [person(), person({ id: "p2", name: "Ravi K", usn: "U2", email: "r@x.com" })], teams: [] });
    fireEvent.click(await screen.findByRole("tab", { name: /Teams/ }));

    fireEvent.change(screen.getByLabelText("How many teams"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /Preview split \(2 people\)/ }));
    expect(await screen.findByText("Team 1 · 1")).toBeInTheDocument();
    expect(screen.getByText("Team 2 · 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Create 2 teams" }));
    await waitFor(() => expect(api.assignParticipantsToTeams).toHaveBeenCalled());
    expect(api.createEventTeams).toHaveBeenCalledWith("ev1", ["Team 1", "Team 2"]);
    const assignments = api.assignParticipantsToTeams.mock.calls[0][1];
    expect(assignments).toHaveLength(2);
    expect(new Set(assignments.map((a) => a.team_id))).toEqual(new Set(["t0", "t1"]));
    expect(new Set(assignments.map((a) => a.participant_id))).toEqual(new Set(["p1", "p2"]));
  });

  it("attendance tab lists who is not yet present and toggles with one tap", async () => {
    api.setParticipantsAttendance.mockResolvedValue(1);
    setup({ participants: [person({ attended: true }), person({ id: "p2", name: "Ravi K", usn: "U2", email: "r@x.com" })] });
    fireEvent.click(await screen.findByRole("tab", { name: /Attendance/ }));
    expect(await screen.findByText("Ravi K")).toBeInTheDocument();
    expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument(); // default filter: not yet present
    fireEvent.click(screen.getByText("Ravi K").closest("button"));
    expect(api.setParticipantsAttendance).toHaveBeenCalledWith("ev1", ["p2"], true);
  });
});
