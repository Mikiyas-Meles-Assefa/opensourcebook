import { fireEvent, render as draw, screen, waitFor, within } from "@testing-library/react";
import { VideoPlayer } from "./VideoPlayer";
import type { PlayerProps } from "./players";
import userEvent from "@testing-library/user-event";
import type { JsonObject } from "../api/types";
import { now } from "../test/fakeEngine";
import { renderApp } from "../test/render";
import { asVideo, sceneAt } from "./videoData";

const scenes = [
  { id: "s1", kind: "question", durationMs: 5000, visual: { kind: "photo", description: "A clear blue sky." }, narration: "Why is the sky blue?", onScreenText: ["Why blue?"], cites: [] },
  { id: "s2", kind: "explain", durationMs: 10000, visual: { kind: "animation", description: "Blue light scattering off dots." }, narration: "Air scatters blue light more.", onScreenText: [], cites: [{ sourceId: "s1", spot: "passage", quote: "scatter short wavelengths" }] },
];
const render = { by: "storyboard", storyboard: true, assetId: "a1", url: "/v1/assets/a1", contentType: "video/mp4", width: 720, height: 1280, fps: 10, durationMs: 15000, audio: false, captions: true, scenes: [{ id: "s1", startMs: 0, endMs: 5000 }, { id: "s2", startMs: 5000, endMs: 15000 }], renderMs: 900, madeAt: now };

function output(id: string, payload: JsonObject) {
  return { id, type: "video", title: `Video ${id}`, schemaVersion: 1, costUsd: 0.02, createdAt: now, updatedAt: now, payload, citations: [{ sourceId: "s1" }], prompt: "Explain.", sources: [{ sourceId: "s1" }], projectId: "p1", planId: "pl1", itemId: id === "o1" ? "i1" : "i2" };
}
const item = (id: string, outputId: string) => ({ id, level: 1, ord: Number(id.slice(1)), type: "video", title: `Item ${id}`, settings: {}, enabled: true, status: "done", sources: [], done: false, outputId });

function routes(payload: JsonObject = { schemaVersion: 1, title: "Sky", idea: "Blue scatters more.", aspect: { width: 9, height: 16 }, scenes, render }) {
  return {
    "GET /v1/outputs/:id": ({ params }: { params: Record<string, string> }) => ({ output: output(params.id!, payload) }),
    "GET /v1/projects/:id": { project: { id: "p1", title: "Physics", settings: {}, createdAt: now, updatedAt: now } },
    "GET /v1/sources/:id": { source: { id: "s1", kind: "text", title: "Sky notes", createdAt: now, updatedAt: now }, extraction: { contentHash: "h", kind: "text", status: "ready", title: "Sky notes", createdAt: now, updatedAt: now }, chunkCount: 1 },
    "GET /v1/plans/:id": {
      plan: { id: "pl1", projectId: "p1", title: "Light", version: 1, status: "running", createdAt: now, updatedAt: now, kickedOffAt: now },
      stages: [], edges: [], counts: { total: 2, done: 0 }, estimateUsd: 0, issues: [],
      items: [item("i1", "o1"), item("i2", "o2")],
    },
    "POST /v1/plans/:id/items/:itemId/done": { item: { id: "i1", done: true }, counts: { total: 2, done: 1 } },
  };
}

test("a video is only the video: its file in its own shape, with no scene list, panel, chips or mark", async () => {
  const { container } = renderApp("/outputs/o1", routes());
  const player = await screen.findByLabelText("Video o1");
  expect(player).toHaveAttribute("src", "/api/v1/assets/a1");
  // No browser controls: their bar would cover the captions at the bottom of the frame.
  expect(player).not.toHaveAttribute("controls");
  expect((container.querySelector(".vscreen") as HTMLElement).style.getPropertyValue("--shape")).toBe("720 / 1280");
  const stage = container.querySelector(".vstage")!;
  expect(stage.children).toHaveLength(1);
  expect(within(stage as HTMLElement).getByRole("button", { name: "Play" })).toBeInTheDocument();
  // The time is the chrome's thin line along the bottom, a control that moves it.
  expect(await screen.findByRole("slider", { name: "Where you are" })).toBeInTheDocument();
  expect(within(stage as HTMLElement).queryByText("Storyboard")).not.toBeInTheDocument();
  expect(within(stage as HTMLElement).queryByText("Why is the sky blue?")).not.toBeInTheDocument();
  expect(within(stage as HTMLElement).queryByRole("link")).not.toBeInTheDocument();
  expect(screen.queryByRole("complementary", { name: "Scenes" })).not.toBeInTheDocument();
});

test("a finished video is drawn the same way: the rule does not depend on being a storyboard", async () => {
  const { container } = renderApp("/outputs/o1", routes({ idea: "", scenes, render: { ...render, storyboard: false, by: "studio", width: 1280, height: 720 } }));
  await screen.findByLabelText("Video o1");
  expect(container.querySelector(".vstage")!.children).toHaveLength(1);
  expect((container.querySelector(".vscreen") as HTMLElement).style.getPropertyValue("--shape")).toBe("1280 / 720");
});

test("a video has no skip buttons: no back or forward by seconds, in the player or its chrome", async () => {
  renderApp("/outputs/o1", routes());
  await screen.findByLabelText("Video o1");
  expect(screen.queryAllByRole("button", { name: /seconds|skip|back \d|forward/i })).toHaveLength(0);
});

const NO_SOUND = "No voice set up: videos are made without sound, with captions carrying the words. For a voice, pick one in Settings, under Voice.";
const silent = { ...render, storyboard: false, by: "scenes", audio: false, maker: { id: "scenes", label: "Drawn scenes", voice: { id: "silent", label: "No voice (made without sound)", real: false, note: NO_SOUND } } };

test("a video made without sound plays, and says it has none and why, so it is not taken for a broken player", async () => {
  const { container } = renderApp("/outputs/o1", routes({ idea: "", scenes, render: silent }));
  const player = await screen.findByLabelText("Video o1");
  expect(player).toHaveAttribute("src", "/api/v1/assets/a1");
  // It still plays: the play mark and the time bar are there, and it never asks for sound.
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
  expect(await screen.findByRole("slider", { name: "Where you are" })).toBeInTheDocument();
  fireEvent.play(player);
  expect(screen.queryByRole("button", { name: "Turn the sound on" })).not.toBeInTheDocument();
  const mark = within(container.querySelector(".vquiet") as HTMLElement).getByRole("button", { name: "No sound" });
  expect(mark).toHaveAttribute("aria-expanded", "false");
  await userEvent.click(mark);
  expect(screen.getByRole("note")).toHaveTextContent(NO_SOUND);
});

test("a silent video drawn as a neighbour (a set of cards in view above it) wears no label; in view it does", () => {
  const out = output("o1", { schemaVersion: 1, title: "Sky", idea: "", aspect: { width: 9, height: 16 }, scenes, render: silent }) as unknown as PlayerProps["output"];
  const { container, rerender } = draw(<VideoPlayer output={out} go={() => undefined} finish={null} sources={[]} active={false} />);
  expect(container.querySelector(".vquiet")).toBeNull();
  rerender(<VideoPlayer output={out} go={() => undefined} finish={null} sources={[]} active />);
  expect(container.querySelector(".vquiet")).not.toBeNull();
});

test("a video with sound, and a storyboard, show no such mark", async () => {
  const { container, unmount } = renderApp("/outputs/o1", routes({ idea: "", scenes, render: { ...render, storyboard: false, audio: true } }));
  await screen.findByLabelText("Video o1");
  expect(container.querySelector(".vquiet")).toBeNull();
  unmount();
  const again = renderApp("/outputs/o1", routes());
  await screen.findByLabelText("Video o1");
  expect(again.container.querySelector(".vquiet")).toBeNull();
});

test("playing to the end ticks the plan item done", async () => {
  const { calls } = renderApp("/outputs/o1", routes());
  const player = await screen.findByLabelText("Video o1");
  // The plan has to be read before the player knows its item.
  await screen.findByRole("button", { name: "Done" });
  fireEvent.ended(player);
  await waitFor(() => expect(calls.find((c) => c.path === "/v1/plans/pl1/items/i1/done")?.body).toEqual({ done: true, outputId: "o1" }));
});

test("has nothing sideways: down goes to the next thing, right does nothing", async () => {
  renderApp("/outputs/o1", routes());
  await screen.findByLabelText("Video o1");
  await userEvent.keyboard("{ArrowRight}");
  expect(screen.getByLabelText("Video o1")).toBeInTheDocument();
  await userEvent.keyboard("{ArrowDown}");
  expect(await screen.findByLabelText("Video o2")).toBeInTheDocument();
});

test("one with no file says so in its screen", async () => {
  renderApp("/outputs/o1", routes({ schemaVersion: 1, title: "Sky", idea: "", aspect: { width: 9, height: 16 }, scenes }));
  expect(await screen.findByText("This video has no file yet.")).toBeInTheDocument();
});

test("reads a payload defensively", () => {
  const read = asVideo({ scenes: [{ narration: "Hi", visual: "nope" }, "junk"], render: { url: "/v1/assets/x", scenes: [] } });
  expect(read.scenes).toHaveLength(1);
  expect(read.scenes[0]).toMatchObject({ id: "s1", narration: "Hi", visual: { kind: "", description: "" } });
  // A render that does not say it is finished is read as a storyboard; spans fall back to the planned lengths.
  expect(read.render).toMatchObject({ storyboard: true, scenes: [{ id: "s1", startMs: 0, endMs: 0 }] });
  expect(asVideo({ scenes: [] }).render).toBeUndefined();
});

test("a tap plays and pauses; the play mark shows only while paused", async () => {
  renderApp("/outputs/o1", routes());
  const player = (await screen.findByLabelText("Video o1")) as HTMLVideoElement;
  const play = vi.spyOn(player, "play").mockImplementation(() => Promise.resolve());
  await userEvent.click(screen.getByRole("button", { name: "Play" }));
  expect(play).toHaveBeenCalled();
  fireEvent.play(player);
  expect(screen.queryByRole("button", { name: "Play" })).not.toBeInTheDocument();
  fireEvent.pause(player);
  expect(screen.getByRole("button", { name: "Play" })).toBeInTheDocument();
});

test("it says where the person is with the scene playing then, as soon as the file is ready, as it plays and when it keeps it", () => {
  const out = output("o1", { schemaVersion: 1, title: "Sky", idea: "", aspect: { width: 9, height: 16 }, scenes, render }) as unknown as PlayerProps["output"];
  const here = vi.fn();
  const keep = vi.fn();
  draw(<VideoPlayer output={out} go={() => undefined} finish={null} sources={[]} here={here} keep={keep} />);
  const player = screen.getByLabelText("Video o1") as HTMLVideoElement;
  fireEvent.loadedMetadata(player);
  expect(here).toHaveBeenLastCalledWith({ time: 0, scene: "s1" });
  Object.defineProperty(player, "currentTime", { value: 7.2, configurable: true });
  fireEvent.timeUpdate(player);
  expect(here).toHaveBeenLastCalledWith({ time: 7.2, scene: "s2" });
  // What is kept on a pause says the scene too.
  fireEvent.pause(player);
  expect(keep).toHaveBeenLastCalledWith({ time: 7.2, scene: "s2" });
  // Past the last span, it is still the last scene.
  expect(sceneAt(asVideo({ scenes, render }), 99)).toBe("s2");
  expect(sceneAt(asVideo({ scenes }), 1)).toBeUndefined();
});

test("a dragged progress line moves the video on release", () => {
  const out = output("o1", { schemaVersion: 1, title: "Sky", idea: "", aspect: { width: 9, height: 16 }, scenes, render }) as unknown as PlayerProps["output"];
  const here = vi.fn();
  const keep = vi.fn();
  draw(<VideoPlayer output={out} go={() => undefined} finish={null} sources={[]} here={here} keep={keep} />);
  const player = screen.getByLabelText("Video o1") as HTMLVideoElement;
  Object.defineProperty(player, "duration", { value: 10, configurable: true });
  fireEvent.loadedMetadata(player);
  Object.defineProperty(player, "currentTime", { value: 2, writable: true, configurable: true });
  fireEvent.timeUpdate(player);
  const line = screen.getByRole("slider", { name: "Where you are" }) as HTMLInputElement;
  expect(line.value).toBe("200");
  fireEvent.pointerDown(line);
  fireEvent.input(line, { target: { value: "800" } });
  expect(line.value).toBe("800");
  expect(player.currentTime).toBe(2);
  fireEvent.timeUpdate(player);
  expect(line.value).toBe("800");
  fireEvent.pointerUp(line);
  expect(player.currentTime).toBe(8);
});
