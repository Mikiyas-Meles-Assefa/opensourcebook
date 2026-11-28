import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { Source } from "../api/types";
import { LIVE_MS, useLiveSources } from "./useLiveSources";

const source = (id: string): Source => ({ id, kind: "markdown", status: "ready", createdAt: "2026-11-28T00:00:00.000Z", updatedAt: "2026-11-28T00:00:00.000Z" }) as Source;

afterEach(() => vi.useRealTimers());

test("a project opened from a folder takes the new list on its own, only when it differs; one with no folder is not looked at", async () => {
  vi.useFakeTimers();
  let listed = [source("a")];
  const load = vi.fn(async () => listed);
  const set = vi.fn();
  const { rerender } = renderHook(({ folder }) => useLiveSources(folder, [source("a")], load, set), { initialProps: { folder: "/Users/me/Course" as string | undefined } });
  await act(() => vi.advanceTimersByTimeAsync(LIVE_MS));
  expect(load).toHaveBeenCalledTimes(1);
  expect(set).not.toHaveBeenCalled();
  listed = [source("a"), source("b")];
  await act(() => vi.advanceTimersByTimeAsync(LIVE_MS));
  expect(set).toHaveBeenCalledWith(listed);

  rerender({ folder: undefined });
  load.mockClear();
  await act(() => vi.advanceTimersByTimeAsync(LIVE_MS * 3));
  expect(load).not.toHaveBeenCalled();
});
