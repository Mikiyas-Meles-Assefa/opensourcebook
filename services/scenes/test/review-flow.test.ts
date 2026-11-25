/**
 * The fresh viewer end to end, with a fake connector that plays both the maker and the viewer: the viewer's blind turn
 * on the finished cut, the maker's one polish turn on its notes, and every way the round can end without costing the
 * person their video. Building, rendering and watching are real; the voice is the silent one.
 */
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { closeRenderer } from "../pipeline/stages/scene.ts";
import { useChrome } from "../src/chrome.ts";
import { Connector } from "../src/connector.ts";
import { Jobs, type JobsOptions } from "../src/jobs.ts";
import { VIEWER_MINUTES, VIEWER_SYSTEM } from "../src/review.ts";
import { createScenesServer } from "../src/server.ts";
import { allStyles, listStyles } from "../src/styles.ts";
import { voiceFromEnv } from "../src/voice.ts";
import { passages, script, sources } from "./fixtures/scenes.ts";

useChrome();
const TOKEN = "scenes-token-0123456789";
const CONNECTOR_TOKEN = "connector-token-0123456789";
const servers: Server[] = [];
const dirs: string[] = [];
after(async () => {
  for (const s of servers) s.close();
  await closeRenderer();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

async function listen(server: Server): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

type Call = (name: string, args: unknown) => Promise<any>;
type Play = (call: Call, start: any) => Promise<void | Record<string, unknown>>;

/** A connector whose agent plays `play` with each turn's tools, then reports its end; a stop ends the turn as stopped. */
async function fakeConnector(play: Play) {
  const starts: any[] = [];
  const stopped: string[] = [];
  const live = new Set<string>();
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    if (request.headers.authorization !== `Bearer ${CONNECTOR_TOKEN}`) return response.writeHead(401).end();
    if (request.url === "/status") return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ agent: "fake", agents: [{ id: "fake", label: "Fake agent", installed: true, signedIn: true }] }));
    const stop = /^\/turns\/(.+)\/stop$/.exec(request.url ?? "");
    if (stop) {
      stopped.push(decodeURIComponent(stop[1]!));
      return response.writeHead(200).end("{}");
    }
    const one = /^\/turns\/([^/]+)$/.exec(request.url ?? "");
    if (request.method === "GET" && one) return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ running: live.has(decodeURIComponent(one[1]!)) }));
    const start = JSON.parse(raw);
    starts.push(start);
    live.add(start.turnId);
    response.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, agent: "fake" }));
    const headers = { authorization: `Bearer ${start.callback.token}`, "content-type": "application/json" };
    const call: Call = async (name, args) => (await fetch(`${start.callback.url}/tools`, { method: "POST", headers, body: JSON.stringify({ name, arguments: args }) })).json();
    let outcome = { outcome: "done", text: "done", model: "small-1" } as Record<string, unknown>;
    try {
      outcome = (await play(call, start)) ?? outcome;
    } catch (e) {
      outcome = { outcome: "failed", problem: "error", text: (e as Error).message };
    }
    live.delete(start.turnId);
    await fetch(`${start.callback.url}/finish`, { method: "POST", headers, body: JSON.stringify(outcome) });
  });
  return { url: await listen(server), starts, stopped };
}

async function service(play: Play, options: Partial<JobsOptions> = {}, dir = mkdtempSync(join(tmpdir(), "opensourcebook-scenes-review-flow-"))) {
  dirs.push(dir);
  const connector = await fakeConnector(play);
  let base = "";
  const c = new Connector({ url: connector.url, token: CONNECTOR_TOKEN });
  const voice = voiceFromEnv({});
  const jobs = new Jobs({ dataDir: dir, connector: c, voice, styles: listStyles, callbackBase: () => base, log: () => undefined, ...options });
  base = await listen(createScenesServer({ token: TOKEN, jobs, connector: c, voice, styles: allStyles, dataDir: dir }));
  const api = (path: string, init: RequestInit = {}) => fetch(`${base}${path}`, { ...init, headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  const until = async (id: string, states: string[], tries = 3000) => {
    for (let i = 0; i < tries; i++) {
      const job = await api(`/videos/${id}`).then((r) => r.json()).catch(() => undefined);
      if (job && states.includes(job.state)) return job;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error(`${id} never reached ${states.join("/")}`);
  };
  return { api, until, connector, jobs, dir };
}

const body = (id: string, extra = {}) => JSON.stringify({ id, title: "Levers", brief: "how a lever lifts a load", frame: { width: 1080, height: 1920 }, targetSeconds: 12, style: "auto", passages, ...extra });

const isViewer = (start: any) => start.tools.some((t: any) => t.name === "submit_review");
const isPolish = (start: any) => /# The viewer's notes/.test(start.prompt);

/** The maker's first turn: two beats, rendered, watched, finished. */
async function maker(call: Call): Promise<void> {
  await call("read_passages", { ids: ["p1"] });
  await call("about_video", { title: script.title, idea: script.idea, style: "flat" });
  for (const [i, id] of (["s1", "s2"] as const).entries()) {
    const built = await call("write_beat", { ...script.scenes[i], source: sources[id] });
    if (built.isError) throw new Error(built.text);
  }
  await call("sound", { music: [], effects: [] });
  const made = await call("render", {});
  if (made.isError) throw new Error(made.text);
  await call("watch", { phone: true });
  await call("finish", {});
}

const review = (faults: unknown[]) => ({
  taught: "A lever is a bar that turns on a fixed point. Pushing far from that point lifts a load close to it.",
  worked: { strengths: ["the bar is drawn plainly"], bestMoment: "the load lit up near the end" },
  faults,
  weakestMoment: faults.length ? "the second scene's title" : "",
  topChange: faults.length ? "Show the load rising." : "",
});

/** A viewer that watches the whole video and sends its review. */
const viewer = (faults: unknown[]) => async (call: Call) => {
  const seen = await call("watch_video", {});
  if (seen.isError || !seen.images?.length) throw new Error(seen.text);
  const sent = await call("submit_review", review(faults));
  if (sent.isError) throw new Error(sent.text);
};

test("a viewer that finds nothing in the way watches the finished cut blind, and the person gets that very file; a request can ask for it on its own", async () => {
  // The service's setting is off; the request asks for the viewer.
  const s = await service(async (call, start) => (isViewer(start) ? viewer([])(call) : maker(call)));
  assert.equal((await s.api("/videos", { method: "POST", body: body("r-none", { review: true }) })).status, 202);
  const done = await s.until("r-none", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  assert.equal(s.connector.starts.length, 2);
  const [, view] = s.connector.starts;
  // Blind: no folder of its own, only the three tools, the viewer's own instructions and a time limit.
  assert.ok(!("workspace" in view), JSON.stringify(Object.keys(view)));
  assert.deepEqual(view.tools.map((t: any) => t.name), ["watch_video", "watch_frame", "submit_review"]);
  assert.equal(view.systemPrompt, VIEWER_SYSTEM);
  assert.equal(view.timeoutMs, VIEWER_MINUTES * 60_000);
  assert.deepEqual(view.target, { type: "video-review", id: "r-none" });
  assert.match(view.prompt, /made to teach: "Levers"\. how a lever lifts a load/);
  assert.match(view.prompt, /What is said, with when/);
  assert.match(view.prompt, /What code measured in the video/);
  // Never the scenes' sources, the passages beyond what is said, or the script's notes.
  assert.doesNotMatch(view.prompt, /role=title|program lever|longer distance|Notes on simple machines|A long bar balanced/);
  assert.ok(done.steps.some((x: any) => x.label === "A fresh viewer is watching the video"));
  assert.ok(!done.steps.some((x: any) => x.label === "Rendering the video"), "the maker's cut, with no render after it");
  assert.deepEqual(done.result.making.review, { state: "noFaults", cut: 1, faults: 0, via: "tool" });
  assert.equal(done.result.making.handedOver, 1);
  assert.ok(existsSync(join(s.dir, "r-none", "review", "cut-1.mp4")));
  const draft = JSON.parse(readFileSync(join(s.dir, "r-none", "draft.json"), "utf8"));
  assert.equal(draft.review.round, 1);
  assert.equal(draft.review.review.taught, review([]).taught);
});

test("with faults, one polish turn hears the viewer's notes and its beats as they stand; what it changes is the video", async () => {
  const s = await service(
    async (call, start) => {
      if (isViewer(start)) return viewer([{ at: "0:06", what: "the second scene only lights a box", lens: "picture" }])(call);
      if (!isPolish(start)) return maker(call);
      // Knowledge, not orders: the notes, the beats with their place in the cut, and their sources to change surgically.
      assert.match(start.prompt, /for you to weigh/);
      assert.match(start.prompt, /1\. 0:06: the second scene only lights a box \(picture\)/);
      assert.match(start.prompt, /## s2, 0:\d\d\.\d to 0:\d\d\.\d in cut 1\nNarration: Push down far from it/);
      assert.match(start.prompt, /text answer "the load rises" role=answer/);
      assert.match(start.prompt, /No sound placed|Sound: no music/);
      const built = await call("write_beat", { beat: "s2", source: sources.s2.replace('"the load rises"', '"the heavy load rises"') });
      if (built.isError) throw new Error(built.text);
      const made = await call("render", {});
      if (made.isError) throw new Error(made.text);
      await call("finish", {});
    },
    { review: { on: true } },
  );
  await s.api("/videos", { method: "POST", body: body("r-polish") });
  const done = await s.until("r-polish", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  assert.equal(s.connector.starts.length, 3);
  assert.ok(done.steps.some((x: any) => x.label === "Your agent is going over a viewer's notes"));
  assert.deepEqual(done.result.making.review, { state: "polished", cut: 1, faults: 1, via: "tool", changed: ["s2"], soundChanged: false, polishedCut: 2 });
  assert.equal(done.result.making.handedOver, 2);
  // Both cuts are kept: the first in review/, the second as the video.
  const first = readFileSync(join(s.dir, "r-polish", "review", "cut-1.mp4"));
  const second = Buffer.from(await (await s.api("/videos/r-polish/file")).arrayBuffer());
  assert.equal(second.length, done.result.file.bytes);
  assert.notDeepEqual(first, second);
});

test("a viewer cut off before it answers costs nothing: the first cut is the video, and no polish turn starts", async () => {
  const s = await service(async (call, start) => (isViewer(start) ? { outcome: "failed", problem: "agentLimit", text: "limit" } : maker(call)), { review: { on: true } });
  await s.api("/videos", { method: "POST", body: body("r-limit") });
  const done = await s.until("r-limit", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  assert.equal(s.connector.starts.length, 2);
  assert.equal(done.result.making.review.state, "failed");
  assert.match(done.result.making.review.why, /agentLimit/);
  assert.equal(done.result.making.handedOver, 1);
});

test("a review written out in words is read from them; a polish turn cut off puts the first cut and its draft back", async () => {
  const s = await service(
    async (call, start) => {
      if (isViewer(start)) {
        await call("watch_video", {});
        return { outcome: "done", text: "Taught: A lever turns on a fixed point, and a push far from it lifts a load near it.\nWhat worked:\n- plain drawing\nFaults:\n- 0:01: the title is small\n- 0:07 - the box never moves\nTop change: show the load rising" };
      }
      if (!isPolish(start)) return maker(call);
      await call("write_beat", { beat: "s2", source: sources.s2.replace('"the load rises"', '"half done"') });
      return { outcome: "failed", problem: "agentLimit", text: "limit" };
    },
    { review: { on: true } },
  );
  await s.api("/videos", { method: "POST", body: body("r-text") });
  const done = await s.until("r-text", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  assert.equal(s.connector.starts.length, 3);
  const r = done.result.making.review;
  assert.equal(r.state, "keptFirst");
  assert.equal(r.via, "text");
  assert.equal(r.faults, 2);
  assert.match(r.why, /agentLimit/);
  assert.deepEqual(r.changed, ["s2"]);
  assert.equal(done.result.making.handedOver, 1);
  const draft = JSON.parse(readFileSync(join(s.dir, "r-text", "draft.json"), "utf8"));
  assert.doesNotMatch(draft.scenes.s2.source, /half done/);
  assert.deepEqual(draft.review.review.faults, [{ at: "0:01", what: "the title is small" }, { at: "0:07", what: "the box never moves" }]);
  const file = Buffer.from(await (await s.api("/videos/r-text/file")).arrayBuffer());
  assert.deepEqual(file, readFileSync(join(s.dir, "r-text", "review", "cut-1.mp4")));
});

test("one round a video: stopped while the viewer watches, carried on after a restart and revised, no viewer ever starts again", async () => {
  let stopIt: () => Promise<unknown> = async () => undefined;
  const s = await service(
    async (call, start) => {
      if (!isViewer(start)) return maker(call);
      await call("watch_video", {});
      await stopIt();
      return { outcome: "failed", problem: "stopped" };
    },
    { review: { on: true } },
  );
  stopIt = () => s.api("/videos/r-cap/stop", { method: "POST", body: "{}" });
  await s.api("/videos", { method: "POST", body: body("r-cap") });
  assert.equal((await s.until("r-cap", ["stopped", "done", "failed"])).state, "stopped");
  assert.equal(s.connector.starts.length, 2);
  assert.ok(s.connector.stopped.some((id) => id.includes("viewer")));
  // As if the service had stopped while the viewer watched: carried on from what is on disk, by a new service.
  const file = join(s.dir, "r-cap", "job.json");
  writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, "utf8")), state: "writing" }));
  let round = 0;
  const again = await service(
    async (call) => {
      round += 1;
      await call("finish", {});
    },
    { review: { on: true }, resumeDelaysMs: [10] },
    s.dir,
  );
  const done = await again.until("r-cap", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  assert.equal(again.connector.starts.length, 0, "no viewer and no maker: the finished cut is handed over");
  assert.equal(done.result.making.handedOver, 1);
  assert.equal(done.result.making.review.state, "watching");
  // A revise from Open Sourcebook's checker is a turn of the maker alone.
  assert.equal((await again.api("/videos/r-cap/revise", { method: "POST", body: JSON.stringify({ problems: ["a problem"] }) })).status, 202);
  assert.equal((await again.until("r-cap", ["done", "failed"])).state, "done");
  assert.equal(round, 1);
  assert.ok(!again.connector.starts.some(isViewer));
});

test("the viewer stays off for a request that says so, whatever the service's setting", async () => {
  const s = await service(async (call, start) => {
    if (isViewer(start)) throw new Error("no viewer was asked for");
    await maker(call);
  }, { review: { on: true } });
  await s.api("/videos", { method: "POST", body: body("r-off", { review: false }) });
  const done = await s.until("r-off", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  assert.equal(s.connector.starts.length, 1);
  assert.ok(!("review" in done.result.making));
});

test("a request's own reviewer watches on its agent, with its model and effort, and the video's own pick and the service's are not sent to it", async () => {
  const s = await service(async (call, start) => (isViewer(start) ? viewer([])(call) : maker(call)), { review: { on: true, model: "service-model", effort: "max" } });
  assert.equal((await s.api("/videos", { method: "POST", body: body("r-pick", { model: "maker-model", effort: "high", reviewAgent: "fake", reviewModel: "viewer-model", reviewEffort: "low" }) })).status, 202);
  const done = await s.until("r-pick", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  const [make, view] = s.connector.starts;
  assert.deepEqual([make.model, make.effort], ["maker-model", "high"]);
  assert.deepEqual([view.agent, view.model, view.effort], ["fake", "viewer-model", "low"]);
  // The viewer's time is its own, beside the making's.
  assert.ok(done.result.timing.makingSeconds > 0);
  assert.equal(done.result.timing.review.agent, "fake");
  assert.equal(done.result.timing.review.model, "viewer-model");
  assert.equal(done.result.timing.review.effort, "low");
  assert.ok(done.result.timing.review.seconds >= 0);
});

test("an automatic viewer, with no review model or effort set, watches on the video's own model and effort", async () => {
  const s = await service(async (call, start) => (isViewer(start) ? viewer([])(call) : maker(call)), { review: { on: true } });
  assert.equal((await s.api("/videos", { method: "POST", body: body("r-auto", { model: "maker-model", effort: "high" }) })).status, 202);
  const done = await s.until("r-auto", ["done", "failed"]);
  assert.equal(done.state, "done", JSON.stringify(done.failure));
  const [make, view] = s.connector.starts;
  assert.ok(isViewer(view));
  assert.deepEqual([make.model, make.effort], ["maker-model", "high"]);
  assert.deepEqual([view.model, view.effort], ["maker-model", "high"]);
  assert.equal(done.result.timing.review.model, "maker-model");
  assert.equal(done.result.timing.review.effort, "high");
});
