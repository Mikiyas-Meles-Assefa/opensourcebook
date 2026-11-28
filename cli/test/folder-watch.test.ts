import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { counts, FolderWatch, tellsOfChanges } from "../folder-watch.ts";
import { LocalFiles } from "../local-files.ts";

const TAKES = { extensions: new Set(["md", "txt", "pdf"]), maxBytes: 100 };

/** An engine that answers what the watching asks, and keeps each check asked for. */
function fakeEngine(projects: Array<{ id: string; folder?: string; archivedAt?: string }>, status = 200) {
  const checks: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/v1/uploads/types") return Response.json({ maxBytes: TAKES.maxBytes, types: [], folderExtensions: [...TAKES.extensions] });
    if (url.pathname === "/v1/projects") return Response.json({ projects });
    const check = /^\/v1\/projects\/([^/]+)\/folder\/check$/.exec(url.pathname);
    if (check) {
      checks.push(check[1]!);
      return Response.json({}, { status });
    }
    return new Response("no", { status: 404 });
  }) as typeof fetch;
  return { checks, fetchImpl };
}

async function until(what: () => boolean, ms = 5_000): Promise<void> {
  const end = Date.now() + ms;
  while (!what()) {
    if (Date.now() > end) throw new Error("timed out");
    await new Promise((done) => setTimeout(done, 25));
  }
}

test("folder watch: a change counts only when a check could find it different", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opensourcebook-watch-"));
  try {
    writeFileSync(join(dir, "big.md"), "x".repeat(200));
    writeFileSync(join(dir, "small.md"), "x");
    assert.equal(await counts(dir, "small.md", TAKES), true);
    assert.equal(await counts(dir, "gone.md", TAKES), true, "a file removed counts");
    assert.equal(await counts(dir, "week 2", TAKES), true, "a folder may hold files");
    assert.equal(await counts(dir, null, TAKES), true, "a change the system does not name counts");
    assert.equal(await counts(dir, "big.md", TAKES), false, "too large");
    assert.equal(await counts(dir, "Cells.mp4", TAKES), false, "a kind a folder does not give, such as the finished video");
    assert.equal(await counts(dir, ".DS_Store", TAKES), false);
    assert.equal(await counts(dir, "week 1/.hidden/a.md", TAKES), false);
    assert.equal(await counts(dir, "node_modules/x/readme.md", TAKES), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

for (const platform of ["darwin", "linux"] as const) {
  if (platform === "darwin" && !tellsOfChanges(process.platform)) continue;
  test(`folder watch (${platform === "darwin" ? "told by the system" : "listed now and then"}): files added, changed and removed ask for one check a still moment later`, async () => {
    const dir = mkdtempSync(join(tmpdir(), "opensourcebook-watch-"));
    const folder = join(dir, "Course");
    mkdirSync(folder);
    writeFileSync(join(folder, "a.md"), "a");
    const engine = fakeEngine([{ id: "p1", folder }, { id: "p2" }, { id: "p3", folder: dir, archivedAt: "2026-11-01" }]);
    const watch = new FolderWatch({ engine: "http://127.0.0.1:1", token: "t", fetchImpl: engine.fetchImpl, platform, quietMs: 150, listMs: 100 });
    try {
      await watch.refresh();
      assert.deepEqual(watch.folders, { p1: folder }, "only a linked project not archived is watched");
      await new Promise((done) => setTimeout(done, 300));
      assert.deepEqual(engine.checks, [], "nothing changed, nothing asked");

      writeFileSync(join(folder, "b.md"), "b");
      writeFileSync(join(folder, "c.txt"), "c");
      await until(() => engine.checks.length === 1);
      await new Promise((done) => setTimeout(done, 400));
      assert.deepEqual(engine.checks, ["p1"], "two files at once are one check");

      writeFileSync(join(folder, "a.md"), "a, changed");
      await until(() => engine.checks.length === 2);
      rmSync(join(folder, "b.md"));
      await until(() => engine.checks.length === 3);

      writeFileSync(join(folder, "Course.mp4"), "a finished video");
      writeFileSync(join(folder, ".hidden"), "no");
      await new Promise((done) => setTimeout(done, 500));
      assert.equal(engine.checks.length, 3, "a video or a hidden file asks for nothing");
    } finally {
      watch.stop();
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

test("folder watch: a project the engine no longer checks is not watched; the engine's word looks again", async () => {
  const dir = mkdtempSync(join(tmpdir(), "opensourcebook-watch-"));
  const projects: Array<{ id: string; folder?: string }> = [{ id: "p1", folder: dir }];
  const engine = fakeEngine(projects, 409);
  const watch = new FolderWatch({ engine: "http://127.0.0.1:1", token: "t", fetchImpl: engine.fetchImpl, platform: "linux", quietMs: 50, listMs: 50 });
  const files = new LocalFiles({ state: dir, port: 0, token: "files-token-0123456789", onLinks: () => void watch.refresh() });
  await files.start();
  try {
    await watch.refresh();
    assert.deepEqual(watch.folders, { p1: dir });
    await new Promise((done) => setTimeout(done, 150));
    writeFileSync(join(dir, "a.md"), "a");
    await until(() => engine.checks.length === 1);
    await until(() => Object.keys(watch.folders).length === 0);

    projects.push({ id: "p2", folder: dir });
    const told = await fetch(`http://127.0.0.1:${files.port}/folder/links`, { method: "POST", headers: { "x-files-token": "files-token-0123456789", "content-type": "application/json" }, body: "{}" });
    assert.equal(told.status, 200);
    await until(() => Object.keys(watch.folders).includes("p2"));
  } finally {
    watch.stop();
    await files.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});
