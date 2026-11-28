import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect, useState, type ReactNode } from "react";
import { MemoryRouter } from "react-router";
import { ChromeSlot, ChromeTools, PlayerChrome, ProgressLine, type ChromeReport } from "./chrome";
import { useChrome, type Segment } from "./useChrome";

/** A player that says what it is given and listens for up and down itself, as an older one might. */
function Inner({ segments, onKey }: { segments?: Segment[]; onKey?: (key: string) => void }) {
  useChrome({ title: "Inner title", progress: 0.5, ...(segments ? { segments } : {}) });
  useEffect(() => {
    if (!onKey) return;
    const listen = (e: KeyboardEvent) => onKey(e.key);
    window.addEventListener("keydown", listen);
    return () => window.removeEventListener("keydown", listen);
  }, [onKey]);
  return (
    <div className="pstage">
      <ChromeTools>
        <button type="button">Change it</button>
      </ChromeTools>
      <p>Inner content</p>
    </div>
  );
}

function Framed({ children, onNext }: { children: ReactNode; onNext?: () => void }) {
  const [report, setReport] = useState<ChromeReport>();
  return (
    <MemoryRouter>
      <PlayerChrome variant="panel" title="Own title" back={{ label: "Back", onClick: () => {} }} report={report} onNext={onNext}>
        <ChromeSlot onReport={setReport}>{children}</ChromeSlot>
      </PlayerChrome>
    </MemoryRouter>
  );
}

test("a player inside the chrome sets its title and line, and puts its tools in the bar", async () => {
  render(
    <Framed>
      <Inner />
    </Framed>,
  );
  expect(await screen.findByRole("heading", { name: "Inner title" })).toBeInTheDocument();
  expect(screen.getByRole("progressbar", { name: "Where you are" })).toHaveAttribute("aria-valuenow", "50");
  const bar = screen.getByRole("banner");
  expect(within(bar).getByRole("button", { name: "Change it" })).toBeInTheDocument();
  // A player that paints its own screen is not pushed down; it keeps clear of the bar with --player-top.
  expect(screen.getByText("Inner content").closest(".pc-slot")).not.toBeNull();
});

test("a segmented line draws one piece per step in its state", async () => {
  render(
    <Framed>
      <Inner segments={["good", "warn", "now", "todo"]} />
    </Framed>,
  );
  await waitFor(() => expect(document.querySelectorAll(".pc-seg")).toHaveLength(4));
  expect([...document.querySelectorAll(".pc-seg")].map((el) => el.className)).toEqual(["pc-seg good", "pc-seg warn", "pc-seg now", "pc-seg todo"]);
  expect(screen.getByRole("progressbar", { name: "Where you are" })).toHaveAttribute("aria-valuenow", "2");
});

test("the chrome owns down: a player listening for it too does not hear it, so nothing moves twice", async () => {
  const onNext = vi.fn();
  const heard = vi.fn();
  render(
    <Framed onNext={onNext}>
      <Inner onKey={heard} />
    </Framed>,
  );
  await screen.findByRole("heading", { name: "Inner title" });
  await userEvent.keyboard("{ArrowDown}");
  expect(onNext).toHaveBeenCalledTimes(1);
  expect(heard).not.toHaveBeenCalledWith("ArrowDown");
  await userEvent.keyboard("{ArrowRight}");
  expect(heard).toHaveBeenCalledWith("ArrowRight");
});

test("outside a chrome a player's tools are not drawn", () => {
  render(
    <MemoryRouter>
      <Inner />
    </MemoryRouter>,
  );
  expect(screen.queryByRole("button", { name: "Change it" })).not.toBeInTheDocument();
});

test("the progress line keeps its place while it is dragged", () => {
  const onSeek = vi.fn();
  const { rerender } = render(<ProgressLine progress={0.2} onSeek={onSeek} />);
  const line = screen.getByRole("slider", { name: "Where you are" }) as HTMLInputElement;
  expect(line.value).toBe("200");
  fireEvent.pointerDown(line);
  fireEvent.input(line, { target: { value: "800" } });
  expect(line.value).toBe("800");
  expect(onSeek).not.toHaveBeenCalled();
  rerender(<ProgressLine progress={0.2} onSeek={onSeek} />);
  expect(line.value).toBe("800");
  fireEvent.pointerUp(line);
  expect(onSeek).toHaveBeenCalledTimes(1);
  expect(onSeek).toHaveBeenCalledWith(0.8);
  rerender(<ProgressLine progress={0.8} onSeek={onSeek} />);
  expect(line.value).toBe("800");
});

test("the keyboard seeks at once", () => {
  const onSeek = vi.fn();
  render(<ProgressLine progress={0.2} onSeek={onSeek} />);
  const line = screen.getByRole("slider", { name: "Where you are" }) as HTMLInputElement;
  fireEvent.input(line, { target: { value: "201" } });
  expect(onSeek).toHaveBeenCalledTimes(1);
  expect(onSeek).toHaveBeenCalledWith(0.201);
});
