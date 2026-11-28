import { act, fireEvent, render, screen } from "@testing-library/react";
import { CopyButton, OutlineButton, PrimaryButton } from "./Buttons";

test("the outlined and the filled pill are plain buttons that keep what they are given", () => {
  render(
    <>
      <OutlineButton icon="play" aria-label="Play the quiz">Play</OutlineButton>
      <PrimaryButton wide disabled>Make the video</PrimaryButton>
    </>,
  );
  expect(screen.getByRole("button", { name: "Play the quiz" })).toHaveClass("obtn");
  expect(screen.getByRole("button", { name: "Make the video" })).toHaveClass("pbtn", "wide");
  expect(screen.getByRole("button", { name: "Make the video" })).toBeDisabled();
});

test("Copy puts the text on the clipboard and shows Copied with a check for a moment", async () => {
  vi.useFakeTimers();
  const writeText = vi.fn(() => Promise.resolve());
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  render(<CopyButton text="npm install -g @github/copilot" />);
  const button = screen.getByRole("button", { name: "Copy" });
  await act(async () => fireEvent.click(button));
  expect(writeText).toHaveBeenCalledWith("npm install -g @github/copilot");
  expect(button).toHaveTextContent("Copied");
  expect(button).toHaveClass("copied");
  act(() => vi.advanceTimersByTime(1600));
  expect(button).toHaveTextContent("Copy");
  expect(button).not.toHaveClass("copied");
  vi.useRealTimers();
});

test("a copy the browser refuses leaves the button as it was", async () => {
  Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("no")) }, configurable: true });
  render(<CopyButton text="x" label="Copy reply" />);
  const button = screen.getByRole("button", { name: "Copy reply" });
  await act(async () => fireEvent.click(button));
  expect(button).toHaveTextContent("Copy");
  expect(button).not.toHaveClass("copied");
});
