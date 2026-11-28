/**
 * A copy's own data from before every copy shared the app data folder (app-data.ts): a clone, or the one-line install's
 * `app/`, kept its settings in `.opensourcebook/` (or `.re/`), its projects in `engine/.wrangler/state` and its videos'
 * files in `services/scenes/.data`. The first start that uses the app's usual folder reads the old places and writes the
 * new one, once:
 *
 *  - the app data folder holds no projects yet: each old folder is moved in, in one step on the same disk (copied,
 *    checked and only then removed when the app data folder is on another disk), and one line says so;
 *  - it holds projects already: nothing is moved, merged or deleted, and one line says the old folders are no longer
 *    used and the person can delete them.
 *
 * A thing is moved at most once, and nothing is ever deleted that was not first copied whole.
 */
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, renameSync, rmdirSync, rmSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { IN_APP_DATA } from "./app-data.ts";
import { projectCounts } from "./database.ts";
import { findLauncher, ownChildren, readRunning } from "./record.ts";
import { OLD_STATE_DIR, STATE_DIR } from "./state.ts";

export interface Place {
  /** Where the copy kept it. */
  from: string;
  /** Where it belongs in the app data folder. */
  to: string;
}

/** The copy's old places, each with its place in the app data folder; the engine's data is second. */
export function oldPlaces(root: string, appData: string): Place[] {
  const state = existsSync(join(root, STATE_DIR)) || !existsSync(join(root, OLD_STATE_DIR)) ? join(root, STATE_DIR) : join(root, OLD_STATE_DIR);
  return [
    { from: state, to: join(appData, IN_APP_DATA.state) },
    { from: join(root, "engine", ".wrangler", "state"), to: join(appData, IN_APP_DATA.data) },
    { from: join(root, "services", "scenes", ".data"), to: join(appData, IN_APP_DATA.scenes) },
  ];
}

/** A real folder (not a link) with something in it. */
export function hasEntries(dir: string): boolean {
  try {
    return lstatSync(dir).isDirectory() && readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/** The projects in an engine data folder, over every database file in it, read without changing anything. */
export function projectsIn(engineData: string, counts: (files: string[]) => Record<string, number> = projectCounts): number {
  const dir = join(engineData, "v3", "d1", "miniflare-D1DatabaseObject");
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".sqlite") && f !== "metadata.sqlite").map((f) => join(dir, f));
  } catch {
    return 0;
  }
  return Object.values(counts(files)).reduce((a, b) => a + b, 0);
}

export interface MoveOptions {
  say: (line: string) => void;
  /** For tests: the project count of an engine data folder, and the calls that change the disk. */
  projects?: (engineData: string) => number;
  rename?: (from: string, to: string) => void;
  now?: () => Date;
}

/**
 * Settles the copy at `root` against the app data folder, as the module comment says. Returns undefined when the start
 * may go on, else the one line that says why it must not (an Open Sourcebook still running from the old folders, whose
 * files cannot be moved under it).
 */
export function settleOldData(root: string, appData: string, options: MoveOptions): string | undefined {
  const places = oldPlaces(root, appData).filter((p) => hasEntries(p.from));
  if (!places.length) return undefined;
  const projects = options.projects ?? ((dir: string) => projectsIn(dir));
  const engine = join(appData, IN_APP_DATA.data);
  const shown = (p: Place) => `${relative(root, p.from).split("\\").join("/")}${p.from.endsWith(STATE_DIR) || p.from.endsWith(OLD_STATE_DIR) ? "/" : ""}`;
  const list = (ps: Place[]) => ps.map(shown).join(", ");
  if (projects(engine) > 0) {
    options.say(`  ${list(places)} in ${root} ${places.length === 1 ? "is" : "are"} no longer used: every copy of Open Sourcebook on this computer keeps its projects and settings in ${appData}, which has yours. Nothing was moved or deleted; once you are sure, you can delete ${places.length === 1 ? "it" : "them"} yourself.`);
    return undefined;
  }
  const oldState = places.find((p) => p.to.endsWith(IN_APP_DATA.state))?.from;
  const running = oldState ? readRunning(oldState) : undefined;
  const there = oldState ? findLauncher(oldState) : undefined;
  if (there || (running && ownChildren(running).length)) {
    return `Open Sourcebook is still running from ${root}'s own folders (process ${there?.pid ?? running?.pid}), so its projects cannot be moved to ${appData} now. Stop it first (Ctrl-C in its terminal, or "opensourcebook stop" there), then start again.`;
  }
  const rename = options.rename ?? renameSync;
  const moved: Place[] = [];
  const left: Place[] = [];
  let setAside = "";
  for (const place of places) {
    if (hasEntries(place.to)) {
      // The engine's folder with no project in it (an empty database a start made) gives way to the one that has them: set aside, never deleted.
      const engineWithProjects = place.to === engine && projects(place.from) > 0;
      if (!engineWithProjects) {
        left.push(place);
        continue;
      }
      setAside = `${place.to} before ${stampOf(options.now?.() ?? new Date())}`;
      rename(place.to, setAside);
    }
    moveFolder(place.from, place.to, rename);
    moved.push(place);
    if (place.to.endsWith(IN_APP_DATA.scenes)) moveJobs(place.to, join(appData, IN_APP_DATA.jobs), rename);
  }
  if (moved.length) options.say(`  Your projects and settings moved from ${list(moved)} in ${root} to ${appData}, where every copy of Open Sourcebook on this computer keeps them now.${setAside ? ` The empty one that was there is kept as ${setAside}.` : ""}`);
  if (left.length) options.say(`  ${list(left)} in ${root} ${left.length === 1 ? "is" : "are"} no longer used, as ${appData} has ${left.length === 1 ? "its" : "their"} place filled already. Nothing in ${left.length === 1 ? "it" : "them"} was deleted; once you are sure, you can delete ${left.length === 1 ? "it" : "them"} yourself.`);
  return undefined;
}

/** The video job folders (each with its job.json) the scenes service kept among its own files go to the jobs folder. */
function moveJobs(scenes: string, jobs: string, rename: (from: string, to: string) => void): void {
  for (const name of readdirSync(scenes)) {
    const from = join(scenes, name);
    if (!existsSync(join(from, "job.json")) || existsSync(join(jobs, name))) continue;
    moveFolder(from, join(jobs, name), rename);
  }
}

/**
 * Moves a folder to a place that is free: in one step on the same disk; across disks a copy, checked file by file
 * against the original, and only then the original removed. A copy that does not match is taken away again and the
 * original stays as it was.
 */
export function moveFolder(from: string, to: string, rename: (from: string, to: string) => void = renameSync): void {
  mkdirSync(dirname(to), { recursive: true, mode: 0o700 });
  // Free means not there or an empty folder; anything in it would stop the move here, before a file is touched.
  if (existsSync(to)) rmdirSync(to);
  try {
    rename(from, to);
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
  }
  cpSync(from, to, { recursive: true, verbatimSymlinks: true, preserveTimestamps: true, errorOnExist: true, force: false });
  const want = tree(from);
  const got = tree(to);
  if (want.length !== got.length || want.some((line, i) => line !== got[i])) {
    rmSync(to, { recursive: true, force: true });
    throw new Error(`the copy of ${from} in ${to} did not match it, so it was taken away again and ${from} is as it was`);
  }
  rmSync(from, { recursive: true, force: true });
}

/** Every path under a folder with its kind and size (a link with where it leads), in order, to tell a whole copy from a part. */
function tree(dir: string, base = dir): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const path = join(dir, name);
    const stat = lstatSync(path);
    const rel = relative(base, path);
    if (stat.isSymbolicLink()) out.push(`${rel} -> ${readlinkSync(path)}`);
    else if (stat.isDirectory()) out.push(`${rel}/`, ...tree(path, base));
    else out.push(`${rel} ${stat.size}`);
  }
  return out;
}

function stampOf(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}.${p(date.getMinutes())}`;
}
