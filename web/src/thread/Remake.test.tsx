import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Message, Remaking } from "../api/types";
import { now, redesignRoutes, sampleProviders, sampleRemakeEngine, sampleSceneVideo, type FakeRequest, type Handler } from "../test/fakeEngine";
import { renderApp } from "../test/render";

/**
 * Remaking one scene from the thread on a video (Thread.tsx, remake.ts):
 * offered only on a thing that says it can, about the scene playing when the
 * thread was opened; it always asks what should change first, filled in with
 * the person's last message when there is one, and starts only when that is
 * confirmed; it says it started, shows it being made with Stop, and a
 * failure with Try again; refusals say why, and a missing pick asks who.
 */
const project = { id: "p1", title: "Cell biology", settings: {}, createdAt: now, updatedAt: now };
const chat = { id: "c1", projectId: "p1", title: "Why a cell checks itself", messageCount: 2, createdAt: now, updatedAt: now };
const about = { item: "d1-i", plan: "d1", output: "v1", format: "video", title: sampleSceneVideo.title, at: { time: 10.5, scene: "s3" }, label: "at 0:10" };
const said: Message[] = [
  { id: "m1", chatId: "c1", seq: 0, role: "user", text: "I think the video says it the other way round.", about, createdAt: now },
  { id: "m2", chatId: "c1", seq: 1, role: "assistant", text: "You're right, the source says both sides.", pieces: [{ kind: "text", text: "You're right, the source says both sides.", cites: [] }] as Message["pieces"], about, createdAt: now },
];

const going: Remaking = { outputId: "v1", scene: "s3", note: "Both sides", job: { id: "rj0", status: "running", stage: "drawing", progress: 0.4, attempt: 1, startedAt: now } };

/** The project with the video made at once, playing it unless `path` says otherwise; `before` sets the engine up first. */
function open(messages: Message[] = said, more: Record<string, Handler> = {}, { path = "/projects/p1?play=v1", before }: { path?: string; before?: (engine: ReturnType<typeof sampleRemakeEngine>) => void } = {}) {
  const engine = sampleRemakeEngine();
  before?.(engine);
  const app = renderApp(path, {
    ...redesignRoutes,
    "GET /v1/projects/:id": { project },
    "GET /v1/projects": { projects: [project] },
    "GET /v1/projects/:id/sources": { sources: [] },
    "GET /v1/projects/:id/chats": { chats: [chat] },
    "GET /v1/chats/:id": { chat, messages },
    "GET /v1/skills": { skills: [], commands: [] },
    "GET /v1/threads": { threads: messages.length ? [{ itemId: "d1-i", chatId: "c1", count: messages.length, lastAt: now }] : [] },
    "GET /v1/plans/:id/items/:itemId/thread": (req: FakeRequest) => ({
      item: { id: "d1-i", planId: "d1", projectId: "p1", title: sampleSceneVideo.title, type: "video", outputId: engine.state.made },
      ...(messages.length ? { chat } : {}),
      messages,
      ...(req.query.get("at") ? { here: { label: "at 0:10" } } : {}),
    }),
    ...engine.routes,
    ...more,
  });
  return { ...app, engine };
}

/** The video plays to the third scene, then the thread is opened on it. */
async function talkAtSceneThree() {
  const playing = await screen.findByRole("complementary", { name: "Playing" });
  const video = await waitFor(() => playing.querySelector("video") ?? Promise.reject(new Error("no video yet")));
  Object.defineProperty(video, "currentTime", { value: 10.5, configurable: true });
  fireEvent.loadedMetadata(video);
  await userEvent.click(within(playing).getByRole("button", { name: /^Talk about this/ }));
  return screen.findByRole("complementary", { name: `Talk about ${sampleSceneVideo.title}` });
}

// A thread left open is remembered on the device; each test starts with it closed.
beforeEach(() => window.localStorage.clear());

const remakes = (calls: FakeRequest[]) => calls.filter((c) => c.method === "POST" && c.path.endsWith("/remake"));

/** Presses Remake this scene, checks nothing starts yet and the note box shows `note`, then confirms it. */
async function remakeWith(thread: HTMLElement, calls: FakeRequest[], note: string) {
  const before = remakes(calls).length;
  await userEvent.click(await within(thread).findByRole("button", { name: "Remake this scene" }, { timeout: 3000 }));
  const box = within(thread).getByRole("form", { name: "What should change?" });
  expect(within(box).getByRole("textbox", { name: "What should change?" })).toHaveValue(note);
  expect(remakes(calls)).toHaveLength(before);
  await userEvent.click(within(box).getByRole("button", { name: /^Remake scene \d+$/ }));
}

test("with something said in the thread, Remake this scene asks first with that as the note, and once confirmed makes the scene playing again, says so, and shows it being made with Stop", async () => {
  const { calls, engine } = open();
  const thread = await talkAtSceneThree();
  await remakeWith(thread, calls, "I think the video says it the other way round.");
  await waitFor(() => expect(remakes(calls)).toHaveLength(1));
  expect(remakes(calls)[0]).toMatchObject({ path: "/v1/outputs/v1/scenes/s3/remake", body: { note: "I think the video says it the other way round." } });
  expect(await within(thread).findByText("Making scene 3 again. The video you have stays until the new one is ready.")).toBeInTheDocument();
  expect(within(thread).getByRole("status")).toHaveTextContent("Waiting to make scene 3 again");
  expect(within(thread).queryByRole("button", { name: "Remake this scene" })).not.toBeInTheDocument();
  // It is read again while it is made.
  engine.run();
  await waitFor(() => expect(within(thread).getByRole("status")).toHaveTextContent("Making scene 3 again"), { timeout: 4000 });
  expect(within(thread).getByRole("progressbar")).toHaveAttribute("aria-valuenow", "40");
  // Stop stops its job; the thread offers it again.
  await userEvent.click(within(thread).getByRole("button", { name: "Stop" }));
  expect(calls.some((c) => c.method === "POST" && c.path === "/v1/jobs/rj1/cancel")).toBe(true);
  expect(await within(thread).findByRole("button", { name: "Remake this scene" })).toBeInTheDocument();
  expect(within(thread).queryByText(/Making scene 3 again/)).not.toBeInTheDocument();
});

test("with something said in the thread, the note can be changed before it is made, and Cancel or Escape makes nothing", async () => {
  const { calls } = open();
  const thread = await talkAtSceneThree();
  await userEvent.click(await within(thread).findByRole("button", { name: "Remake this scene" }));
  let box = within(thread).getByRole("form", { name: "What should change?" });
  expect(within(box).getByText("Your last message is the note. Change it if you like.")).toBeInTheDocument();
  await userEvent.click(within(box).getByRole("button", { name: "Cancel" }));
  expect(within(thread).queryByRole("form", { name: "What should change?" })).not.toBeInTheDocument();
  await userEvent.click(within(thread).getByRole("button", { name: "Remake this scene" }));
  await userEvent.keyboard("{Escape}");
  expect(within(thread).queryByRole("form", { name: "What should change?" })).not.toBeInTheDocument();
  expect(remakes(calls)).toHaveLength(0);
  await userEvent.click(within(thread).getByRole("button", { name: "Remake this scene" }));
  box = within(thread).getByRole("form", { name: "What should change?" });
  const note = within(box).getByRole("textbox", { name: "What should change?" });
  expect(note).toHaveValue("I think the video says it the other way round.");
  await userEvent.clear(note);
  await userEvent.type(note, "Draw the arrow the other way");
  expect(remakes(calls)).toHaveLength(0);
  await userEvent.click(within(box).getByRole("button", { name: "Remake scene 3" }));
  await waitFor(() => expect(remakes(calls)[0]?.body).toEqual({ note: "Draw the arrow the other way" }));
});

test("with nothing said yet, it asks what should change and Enter sends that", async () => {
  const { calls } = open([]);
  const thread = await talkAtSceneThree();
  await userEvent.click(await within(thread).findByRole("button", { name: "Remake this scene" }));
  const box = within(thread).getByRole("form", { name: "What should change?" });
  expect(remakes(calls)).toHaveLength(0);
  expect(within(box).getByRole("textbox", { name: "What should change?" })).toHaveValue("");
  expect(within(box).queryByText(/Your last message is the note/)).not.toBeInTheDocument();
  expect(within(box).getByRole("button", { name: "Remake scene 3" })).toBeDisabled();
  await userEvent.type(within(box).getByRole("textbox", { name: "What should change?" }), "Show both sides pulling{Enter}");
  await waitFor(() => expect(remakes(calls)[0]?.body).toEqual({ note: "Show both sides pulling" }));
  expect(await within(thread).findByText(/^Making scene 3 again\./)).toBeInTheDocument();
  expect(within(thread).queryByRole("form", { name: "What should change?" })).not.toBeInTheDocument();
});

test("a thing that cannot have a scene made again offers nothing", async () => {
  open(said, { "GET /v1/outputs/:id": { output: { ...sampleSceneVideo, remakesScene: undefined } } });
  const thread = await talkAtSceneThree();
  expect(await within(thread).findByText("You're right, the source says both sides.")).toBeInTheDocument();
  expect(within(thread).queryByRole("button", { name: "Remake this scene" })).not.toBeInTheDocument();
});

test("a refusal says why: the engine's own words when it cannot, and that one is being made when it is", async () => {
  const words = "What this video was made from is no longer on this computer, so one scene of it can't be made again. Make the whole video again instead.";
  const { calls, engine } = open();
  const thread = await talkAtSceneThree();
  engine.refuse(409, "cannot_remake", words);
  await remakeWith(thread, calls, "I think the video says it the other way round.");
  expect(await within(thread).findByText(words)).toBeInTheDocument();
  engine.refuse(409, "being_made", "This video is being made now.");
  await userEvent.click(within(thread).getByRole("button", { name: "Remake scene 3" }));
  expect(await within(thread).findByText("One is already being made. Wait for it to be ready, or stop it, then try again.")).toBeInTheDocument();
});

test("with several agents ready and none picked, it asks who makes it and remakes with that pick", async () => {
  const { calls, engine } = open(said, { "GET /v1/providers": { ...sampleProviders, picks: {} } });
  const thread = await talkAtSceneThree();
  engine.refuse(409, "pick_needed", "Pick who makes it in Settings, What makes what.");
  await remakeWith(thread, calls, "I think the video says it the other way round.");
  const picker = await screen.findByRole("dialog", { name: "Made by, for videos" });
  expect(within(picker).getByText("Pick who makes this")).toBeInTheDocument();
  await userEvent.click(within(picker).getByRole("option", { name: /A One/ }));
  await userEvent.click(within(picker).getByRole("button", { name: "Use this" }));
  await waitFor(() => expect(remakes(calls)).toHaveLength(2));
  expect(remakes(calls)[1]?.body).toEqual({ note: "I think the video says it the other way round.", agent: "alpha", model: "a-one" });
  expect(await within(thread).findByText(/^Making scene 3 again\./)).toBeInTheDocument();
  expect(within(thread).queryByText(/Pick who makes it in Settings/)).not.toBeInTheDocument();
});

test("a remake that failed shows why, with Try again making it again with the same note", async () => {
  const { calls, engine } = open();
  engine.state.remaking = { outputId: "v1", scene: "s3", note: "Both sides", job: { id: "rj0", status: "failed", stage: "failed", progress: 0, attempt: 1, errorMessage: "The scene could not be drawn." } };
  const thread = await talkAtSceneThree();
  const line = await within(thread).findByRole("status");
  expect(line).toHaveTextContent("Couldn't make scene 3 again: The scene could not be drawn.");
  expect(within(thread).queryByRole("button", { name: "Remake this scene" })).not.toBeInTheDocument();
  await userEvent.click(within(thread).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(remakes(calls)[0]).toMatchObject({ path: "/v1/outputs/v1/scenes/s3/remake", body: { note: "Both sides" } }));
  await waitFor(() => expect(within(thread).getByRole("status")).toHaveTextContent("Waiting to make scene 3 again"));
});

test("Made here shows the scene being made again under the video, with Stop, and then the new one as the item's", async () => {
  const { calls, engine } = open(said, {}, { path: "/projects/p1", before: (e) => (e.state.remaking = going) });
  const list = await screen.findByRole("list", { name: "Made here" });
  const row = await within(list).findByRole("group", { name: sampleSceneVideo.title });
  expect(within(row).getByRole("button", { name: /Play/ })).toBeInTheDocument();
  await waitFor(() => expect(within(list).getByRole("status")).toHaveTextContent(/Making scene 3 again/));
  expect(within(list).getByRole("button", { name: "Stop" })).toBeInTheDocument();
  // It is made: the line goes, and the row's Play plays the new one.
  engine.finish();
  await waitFor(() => expect(within(list).queryByRole("status")).not.toBeInTheDocument(), { timeout: 4000 });
  await userEvent.click(within(list).getByRole("button", { name: /Play/ }));
  await waitFor(() => expect(calls.some((c) => c.path === "/v1/outputs/v2")).toBe(true));
});

test("Made here stops it, and a failed one shows why with Try again", async () => {
  const { calls, engine } = open(said, {}, { path: "/projects/p1", before: (e) => (e.state.remaking = going) });
  const list = await screen.findByRole("list", { name: "Made here" });
  await userEvent.click(await within(list).findByRole("button", { name: "Stop" }));
  expect(calls.some((c) => c.method === "POST" && c.path === "/v1/jobs/rj0/cancel")).toBe(true);
  await waitFor(() => expect(within(list).queryByRole("status")).not.toBeInTheDocument());
  engine.state.remaking = { ...going, job: { ...going.job, status: "failed", errorMessage: "The scene could not be drawn." } };
  window.dispatchEvent(new CustomEvent("opensourcebook:remake", { detail: { planId: "d1", itemId: "d1-i" } }));
  await waitFor(() => expect(within(list).getByRole("status")).toHaveTextContent("Couldn't make scene 3 again: The scene could not be drawn."));
  await userEvent.click(within(list).getByRole("button", { name: "Try again" }));
  await waitFor(() => expect(remakes(calls)[0]).toMatchObject({ path: "/v1/outputs/v1/scenes/s3/remake", body: { note: "Both sides" } }));
});

test("when the new one is made, the Studio keeps playing the one being watched and offers the new one with Play", async () => {
  const { calls, engine } = open(said, {}, { before: (e) => (e.state.remaking = going) });
  const playing = await screen.findByRole("complementary", { name: "Playing" });
  await waitFor(() => expect(playing.querySelector("video")).not.toBeNull());
  const watched = playing.querySelector("video");
  engine.finish();
  const ready = await within(playing).findByText("The new one is ready", {}, { timeout: 5000 });
  // Nothing moved: the same video is still there, and the new one was only looked at.
  expect(playing.querySelector("video")).toBe(watched);
  expect(within(playing).getByRole("region", { name: sampleSceneVideo.title })).toHaveAttribute("aria-current", "true");
  await userEvent.click(within(ready.closest(".rready") as HTMLElement).getByRole("button", { name: "Play" }));
  await waitFor(() => expect(within(playing).queryByText("The new one is ready")).not.toBeInTheDocument());
  expect(calls.filter((c) => c.path === "/v1/outputs/v2").length).toBeGreaterThan(1);
  expect(within(playing).getByRole("region", { name: sampleSceneVideo.title })).toHaveAttribute("aria-current", "true");
});

test("in the full view, the new one is offered too, and Play goes to it", async () => {
  const { engine } = open(said, {}, { path: "/outputs/v1", before: (e) => e.finish() });
  void engine;
  const ready = await screen.findByText("The new one is ready");
  await userEvent.click(within(ready.closest(".rready") as HTMLElement).getByRole("button", { name: "Play" }));
  await waitFor(() => expect(screen.queryByText("The new one is ready")).not.toBeInTheDocument());
});

test("an older video opened with no remake of it offers nothing", async () => {
  open(said, { "GET /v1/outputs/:id": { output: { ...sampleSceneVideo, id: "v0" } } }, { path: "/outputs/v0" });
  await screen.findByLabelText(sampleSceneVideo.title, { selector: "video" });
  await new Promise((r) => setTimeout(r, 300));
  expect(screen.queryByText("The new one is ready")).not.toBeInTheDocument();
});

test("a thread already open when the page opens is about the first scene the player names", async () => {
  window.localStorage.setItem("opensourcebook.thread.d1-i", "open");
  const { calls } = open();
  const thread = await screen.findByRole("complementary", { name: `Talk about ${sampleSceneVideo.title}` });
  const playing = await screen.findByRole("complementary", { name: "Playing" });
  expect(within(thread).queryByRole("button", { name: "Remake this scene" })).not.toBeInTheDocument();
  const video = await waitFor(() => playing.querySelector("video") ?? Promise.reject(new Error("no video yet")));
  Object.defineProperty(video, "currentTime", { value: 5, configurable: true });
  fireEvent.loadedMetadata(video);
  await remakeWith(thread, calls, "I think the video says it the other way round.");
  await waitFor(() => expect(remakes(calls)[0]?.path).toBe("/v1/outputs/v1/scenes/s2/remake"));
});

test("the @ menu's Playing now row says where the playing video is, from the Studio's player", async () => {
  open([]);
  const playing = await screen.findByRole("complementary", { name: "Playing" });
  const video = await waitFor(() => playing.querySelector("video") ?? Promise.reject(new Error("no video yet")));
  Object.defineProperty(video, "currentTime", { value: 72.4, configurable: true });
  fireEvent.loadedMetadata(video);
  fireEvent.timeUpdate(video);
  await userEvent.type(await screen.findByLabelText("Message"), "@");
  const pop = screen.getByRole("listbox", { name: "Mention" });
  const row = within(pop).getAllByRole("option")[0]!;
  expect(row).toHaveTextContent(sampleSceneVideo.title);
  expect(row).toHaveTextContent(/Video · at 1:12/i);
});
