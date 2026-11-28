import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { redesignRoutes, sampleProviders, sampleSetup, type Handler } from "../test/fakeEngine";
import { renderApp } from "../test/render";
import type { SetupRow } from "../api/types";

const fresh = { ...sampleSetup, done: false, providers: { connected: 0, ready: 0 }, voice: { set: false, skipped: false } };
const ok = (id: string, label: string, text: string): SetupRow => ({ id, label, state: "ok", text });
const lacking: SetupRow[] = [
  ok("node", "Node", "Node 24.1.0"),
  { id: "ffmpeg", label: "ffmpeg", state: "missing", text: "ffmpeg is missing, so videos can't be made", detail: "Install it with `winget install ffmpeg`, then start again." },
  { id: "agent", label: "Coding agent", state: "missing", text: "No coding agent is installed" },
  { id: "signin", label: "Agent sign-in", state: "waiting", text: "Waiting for a coding agent" },
  { id: "voice", label: "Voice", state: "missing", optional: true, text: "No voice yet: videos are made without sound", detail: "For a voice, pick one in Settings, under Voice." },
];
const there: SetupRow[] = [
  ok("node", "Node", "Node 24.1.0"),
  ok("ffmpeg", "ffmpeg", "ffmpeg 7.1"),
  ok("agent", "Coding agent", "Claude Code 2.1.0"),
  ok("signin", "Agent sign-in", "Claude Code can answer"),
  ok("voice", "Voice", "Voice key set (ElevenLabs)"),
];

function open(check: Handler) {
  return renderApp("/welcome/providers", { ...redesignRoutes, "GET /v1/setup": fresh, "GET /v1/providers": sampleProviders, "GET /launcher/setup-check": check });
}

describe("first-time setup: what this computer needs", () => {
  it("lists the five things with where each stands, and what to do about each that is missing", async () => {
    open({ rows: lacking });
    const list = await screen.findByRole("list", { name: "What this computer needs" });
    const rows = within(list).getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("b")?.textContent)).toEqual(["Node", "ffmpeg", "Coding agent", "Agent sign-in", "Voice"]);
    expect(within(list).getByText("Node 24.1.0")).toBeInTheDocument();
    expect(within(list).getByText("ffmpeg is missing, so videos can't be made")).toBeInTheDocument();
    expect(within(list).getByText(/winget install ffmpeg/)).toBeInTheDocument();
    expect(within(list).getByText("Waiting for a coding agent")).toBeInTheDocument();
    // Only a missing row with something to do says it; a waiting row has nothing to do yet.
    expect(list.querySelectorAll(".fr-detail")).toHaveLength(2);
    expect(rows[3]!.querySelector(".fr-detail")).toBeNull();
    expect(within(list).getAllByText("Optional")).toHaveLength(1);
  });

  it("shows no instructions when everything is there", async () => {
    open({ rows: there });
    const list = await screen.findByRole("list", { name: "What this computer needs" });
    expect(within(list).getByText("Claude Code can answer")).toBeInTheDocument();
    expect(list.querySelectorAll(".fr-detail")).toHaveLength(0);
    expect(within(list).queryByText("Optional")).not.toBeInTheDocument();
  });

  it("asks again when Check again is pressed, and shows what changed", async () => {
    let asked = 0;
    const { calls } = open(() => ({ rows: asked++ === 0 ? lacking : there }));
    expect(await screen.findByText("No coding agent is installed")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Claude Code 2.1.0")).toBeInTheDocument();
    expect(screen.queryByText("No coding agent is installed")).not.toBeInTheDocument();
    expect(calls.filter((c) => c.path === "/launcher/setup-check")).toHaveLength(2);
  });

  it.each([
    ["the web app run alone", 503, "phone_unavailable"],
    ["a launcher from before this check", 404, "not_found"],
  ])("is not shown for %s, and the agent step is still there", async (_name, status, error) => {
    open([status, { error, message: "No." }] as unknown as Handler);
    expect(await screen.findByRole("heading", { name: /Connect (the|your) coding agent/ })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Checking this computer…")).not.toBeInTheDocument());
    expect(screen.queryByRole("heading", { name: "What this computer needs" })).not.toBeInTheDocument();
  });

  it("says plainly when the launcher did not answer, and can try again", async () => {
    let asked = 0;
    open(() => (asked++ === 0 ? ([502, { error: "phone_unreachable", message: "The launcher did not answer." }] as unknown as { rows: SetupRow[] }) : { rows: there }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The launcher did not answer.");
    await userEvent.click(screen.getByRole("button", { name: "Check again" }));
    expect(await screen.findByText("Voice key set (ElevenLabs)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
