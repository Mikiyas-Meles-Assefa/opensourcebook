/** A copy's own folders from before every copy shared the app data folder: moved in once, or left for the person to delete. */
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { moveFolder, settleOldData } from "../old-data.ts";
import { processStart } from "../record.ts";

const base = mkdtempSync(join(tmpdir(), "opensourcebook-old-data-"));
after(() => rmSync(base, { recursive: true, force: true }));

/** A clone with the three old folders, a job among the scenes service's files, and a fresh app data folder beside it. */
function layout(name: string): { root: string; data: string } {
  const root = join(base, name, "clone");
  const data = join(base, name, "Application Support", "Open Sourcebook");
  mkdirSync(join(root, ".opensourcebook", "logs"), { recursive: true });
  writeFileSync(join(root, ".opensourcebook", "secrets.json"), '{"PHONE_TOKEN":"kept"}');
  mkdirSync(join(root, "engine", ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject"), { recursive: true });
  writeFileSync(join(root, "engine", ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject", "projects.sqlite"), "database");
  mkdirSync(join(root, "services", "scenes", ".data", "audio"), { recursive: true });
  writeFileSync(join(root, "services", "scenes", ".data", "speed.json"), "{}");
  mkdirSync(join(root, "services", "scenes", ".data", "job-1"), { recursive: true });
  writeFileSync(join(root, "services", "scenes", ".data", "job-1", "job.json"), '{"id":"job-1"}');
  return { root, data };
}

test("an app data folder with no projects yet gets the copy's old folders, once, and says so in one line", () => {
  const { root, data } = layout("empty");
  const said: string[] = [];
  const projects = (dir: string) => (dir.startsWith(root) ? 3 : 0);
  assert.equal(settleOldData(root, data, { say: (l) => said.push(l), projects }), undefined);
  assert.equal(readFileSync(join(data, "state", "secrets.json"), "utf8"), '{"PHONE_TOKEN":"kept"}');
  assert.equal(readFileSync(join(data, "data", "v3", "d1", "miniflare-D1DatabaseObject", "projects.sqlite"), "utf8"), "database");
  assert.ok(existsSync(join(data, "scenes", "speed.json")) && existsSync(join(data, "scenes", "audio")));
  assert.equal(readFileSync(join(data, "jobs", "job-1", "job.json"), "utf8"), '{"id":"job-1"}', "a video's job folder goes to the jobs folder");
  assert.ok(!existsSync(join(data, "scenes", "job-1")));
  for (const old of [".opensourcebook", join("engine", ".wrangler", "state"), join("services", "scenes", ".data")]) assert.ok(!existsSync(join(root, old)), `${old} was moved, not copied`);
  assert.equal(said.length, 1);
  assert.match(said[0]!, /Your projects and settings moved from \.opensourcebook\/, engine\/\.wrangler\/state, services\/scenes\/\.data in .* to .*Open Sourcebook/);

  said.length = 0;
  assert.equal(settleOldData(root, data, { say: (l) => said.push(l), projects }), undefined);
  assert.deepEqual(said, [], "the next start has nothing to move and says nothing");
});

test("an app data folder that has projects already is used as it is: nothing moved, merged or deleted, and one line says the old folders can go", () => {
  const { root, data } = layout("both");
  mkdirSync(join(data, "data", "v3"), { recursive: true });
  mkdirSync(join(data, "state"), { recursive: true });
  writeFileSync(join(data, "state", "secrets.json"), '{"PHONE_TOKEN":"the app\'s"}');
  const said: string[] = [];
  let renamed = 0;
  assert.equal(settleOldData(root, data, { say: (l) => said.push(l), projects: () => 32, rename: () => renamed++ }), undefined);
  assert.equal(renamed, 0);
  assert.ok(existsSync(join(root, ".opensourcebook", "secrets.json")) && existsSync(join(root, "engine", ".wrangler", "state")) && existsSync(join(root, "services", "scenes", ".data", "job-1")));
  assert.equal(readFileSync(join(data, "state", "secrets.json"), "utf8"), '{"PHONE_TOKEN":"the app\'s"}');
  assert.equal(said.length, 1);
  assert.match(said[0]!, /^ {2}\.opensourcebook\/, engine\/\.wrangler\/state, services\/scenes\/\.data in .* are no longer used: .* keeps its projects and settings in .*, which has yours\. Nothing was moved or deleted; once you are sure, you can delete them yourself\.$/);
});

test("an empty database a start made gives way to the copy's projects, set aside and not deleted; a filled place is left", () => {
  const { root, data } = layout("set-aside");
  mkdirSync(join(data, "data", "v3"), { recursive: true });
  writeFileSync(join(data, "data", "v3", "empty.sqlite"), "empty");
  mkdirSync(join(data, "state"), { recursive: true });
  writeFileSync(join(data, "state", "secrets.json"), "{}");
  const said: string[] = [];
  const projects = (dir: string) => (dir.startsWith(root) ? 2 : 0);
  assert.equal(settleOldData(root, data, { say: (l) => said.push(l), projects, now: () => new Date(2026, 10, 28, 9, 5) }), undefined);
  assert.equal(readFileSync(join(data, "data", "v3", "d1", "miniflare-D1DatabaseObject", "projects.sqlite"), "utf8"), "database");
  assert.equal(readFileSync(join(data, "data before 2026-11-28 09.05", "v3", "empty.sqlite"), "utf8"), "empty");
  assert.ok(existsSync(join(root, ".opensourcebook", "secrets.json")), "the state the app data folder has already is kept, and the old one stays");
  assert.equal(said.length, 2);
  assert.match(said[0]!, /moved from engine\/\.wrangler\/state, services\/scenes\/\.data .* The empty one that was there is kept as .*data before 2026-11-28 09\.05\./);
  assert.match(said[1]!, /\.opensourcebook\/ in .* is no longer used/);
});

test("nothing is moved from under an Open Sourcebook still running from the old folders", () => {
  const { root, data } = layout("running");
  writeFileSync(join(root, ".opensourcebook", "running.json"), JSON.stringify({ pid: process.pid, startedAt: processStart(process.pid), url: "http://127.0.0.1:1", ports: {} }));
  const refused = settleOldData(root, data, { say: () => undefined, projects: (dir) => (dir.startsWith(root) ? 1 : 0) });
  assert.match(refused ?? "", /still running from .*clone's own folders .* Stop it first/);
  assert.ok(existsSync(join(root, ".opensourcebook", "secrets.json")) && !existsSync(join(data, "state")));
});

test("across disks a folder is copied, checked and only then removed", () => {
  const from = join(base, "disk", "from");
  mkdirSync(join(from, "inner"), { recursive: true });
  writeFileSync(join(from, "inner", "a.txt"), "aaa");
  const to = join(base, "disk", "elsewhere", "to");
  const exdev = () => {
    throw Object.assign(new Error("cross-device link not permitted"), { code: "EXDEV" });
  };
  moveFolder(from, to, exdev);
  assert.equal(readFileSync(join(to, "inner", "a.txt"), "utf8"), "aaa");
  assert.ok(!existsSync(from));
  // Same disk: one step.
  moveFolder(to, from, renameSync);
  assert.ok(existsSync(join(from, "inner", "a.txt")) && !existsSync(to));
});
