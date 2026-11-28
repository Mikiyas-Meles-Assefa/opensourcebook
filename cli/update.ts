/**
 * Updating Open Sourcebook: whether a newer version is out, and moving this copy to it.
 *
 * A version is a commit on the default branch of the remote this copy was cloned from, shown by its short commit and
 * date. The newest version is that branch's newest commit.
 *
 * Moving to it is a fast-forward and nothing else: never a reset, a stash or a forced anything. When this copy has
 * changes of its own to the files git keeps, is on another branch, is not a git checkout, or has commits the new
 * version lacks, nothing is changed and the answer says what was found and what to do. Files git does not keep (the
 * projects in the local database, `.opensourcebook/`, the `.env` files, anything git-ignored) are left as they are; a new
 * version that would bring a file where one of those already sits is refused too, as git itself would overwrite an
 * ignored one.
 *
 * Only the default branch is fetched, without tags, so a shallow clone (the one docs/DEVELOPING.md makes) stays shallow: the
 * fetch brings the new commits down to the one this copy has and nothing older.
 *
 * The check at start asks the remote for that one branch (`git ls-remote`, the same request a fetch starts with) and
 * nothing else, with a short timeout, and is silent when anything goes wrong.
 */
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";
import { signalTree } from "./supervisor.ts";

export interface GitResult {
  ok: boolean;
  out: string;
  err: string;
}

export type Git = (args: string[]) => GitResult;

const GIT_ENV = { GIT_TERMINAL_PROMPT: "0", LC_ALL: "C" };

/** Runs git in `root`, never asking anything on the terminal. */
export function gitIn(root: string, timeoutMs = 120_000): Git {
  return (args) => {
    const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8", env: { ...process.env, ...GIT_ENV }, timeout: timeoutMs, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    if (r.error) return { ok: false, out: "", err: r.error.message };
    return { ok: r.status === 0, out: (r.stdout ?? "").trimEnd(), err: (r.stderr ?? "").trim() };
  };
}

/**
 * A folder's one true name, to compare two names of it. The native call also undoes what Windows adds: a short
 * 8.3 name such as RUNNER~1, and git's forward slashes. Windows names differ only in case for the same folder.
 */
const real = (path: string) => {
  let name = path;
  try {
    name = realpathSync.native(path);
  } catch {
    // Not there: compared as it was given.
  }
  return process.platform === "win32" ? name.toLowerCase() : name;
};

/** A remote's address with any name and password taken out, so an answer never prints a token. */
export function safeUrl(url: string): string {
  return url.replace(/^([a-z][a-z0-9+.-]*:\/\/)[^@/]*@/i, "$1");
}

export interface Checkout {
  /** The remote this copy follows, by its name in git ("origin"). */
  remote: string;
  url: string;
  /** The remote's default branch ("main"). */
  branch: string;
  head: string;
}

export class Refusal extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/** Where this copy is: its remote, the branch new versions come on, its commit. Refused when it is not on that branch. */
export function locate(root: string, git: Git = gitIn(root)): Checkout {
  const top = git(["rev-parse", "--show-toplevel"]);
  if (!top.ok || real(top.out) !== real(root)) {
    throw new Refusal(
      "not_a_checkout",
      `This Open Sourcebook folder (${root}) is not a git checkout, so opensourcebook update has nothing to fetch from and changed nothing. To get updates, clone Open Sourcebook with git (docs/DEVELOPING.md); your settings and projects are in the app data folder every copy on this computer shares, so the clone finds them (a start moves a folder this copy kept them in there once).`,
    );
  }
  const current = git(["symbolic-ref", "--short", "-q", "HEAD"]);
  const own = current.ok ? current.out : "";
  const remote = (own && git(["config", `branch.${own}.remote`]).out) || "origin";
  const url = git(["remote", "get-url", remote]);
  if (!url.ok) throw new Refusal("no_remote", `This copy of Open Sourcebook has no remote called "${remote}" to fetch a new version from, so opensourcebook update changed nothing. Add the one you cloned from with: git remote add origin <its address>`);
  const branch = defaultBranch(git, remote);
  if (own !== branch) {
    const where = own ? `on the branch "${own}"` : "not on any branch (a single commit is checked out)";
    throw new Refusal("not_default_branch", `This copy of Open Sourcebook is ${where}, not on "${branch}", the branch new versions come on, so opensourcebook update changed nothing. Go back with: git switch ${branch}   then run opensourcebook update again.`);
  }
  return { remote, url: url.out, branch, head: git(["rev-parse", "HEAD"]).out };
}

/** What this copy is, or why it cannot be updated: `locate`, and no changes of its own to the files git keeps. */
export function inspect(root: string, git: Git = gitIn(root)): Checkout {
  const c = locate(root, git);
  const changed = git(["status", "--porcelain=v1", "--untracked-files=no"]);
  if (!changed.ok) throw new Refusal("git_failed", `git could not say whether this copy has changes of its own (${changed.err || "no reason given"}), so opensourcebook update changed nothing.`);
  const files = changed.out.split("\n").filter(Boolean).map((l) => l.slice(3));
  if (files.length) {
    throw new Refusal(
      "local_changes",
      `This copy has changes of its own to files that come with Open Sourcebook (${listed(files)}), so opensourcebook update changed nothing, to keep them safe. To keep them, put them on a branch of your own: git switch -c my-changes && git commit -am "my changes" && git switch ${c.branch}   then run opensourcebook update again. "git status" shows them.`,
    );
  }
  return c;
}

const listed = (files: string[]) => files.slice(0, 5).join(", ") + (files.length > 5 ? ` and ${files.length - 5} more` : "");

function defaultBranch(git: Git, remote: string): string {
  const head = git(["symbolic-ref", "--short", "-q", `refs/remotes/${remote}/HEAD`]);
  if (head.ok && head.out.startsWith(`${remote}/`)) return head.out.slice(remote.length + 1);
  for (const name of ["main", "master"]) if (git(["rev-parse", "--verify", "-q", `refs/remotes/${remote}/${name}`]).ok) return name;
  return "main";
}

/**
 * Fetches the remote's default branch, and only it, without tags: in a shallow clone that brings the new commits and
 * stops at the one this copy has. Returns why it failed, or undefined.
 */
export function fetchBranch(git: Git, c: Checkout): string | undefined {
  const r = git(["fetch", "--quiet", "--no-tags", "--no-recurse-submodules", c.remote, `+refs/heads/${c.branch}:refs/remotes/${c.remote}/${c.branch}`]);
  return r.ok ? undefined : r.err.split("\n").find((l) => l.trim()) || "no reason given";
}

/** "ff0024b of 2026-11-19". */
export function versionOf(git: Git, commit: string): string {
  const short = git(["rev-parse", "--short=7", commit]).out || commit.slice(0, 7);
  const date = git(["log", "-1", "--format=%cs", commit]).out;
  return date ? `${short} of ${date}` : short;
}

const isAncestor = (git: Git, a: string, b: string) => git(["merge-base", "--is-ancestor", a, b]).ok;

/** The version this copy should move to, after a fetch: the remote branch's newest commit. Undefined when this copy has it. */
export function target(git: Git, c: Checkout): string | undefined {
  const tip = git(["rev-parse", "--verify", "-q", `refs/remotes/${c.remote}/${c.branch}^{commit}`]);
  if (!tip.ok || !tip.out || isAncestor(git, tip.out, c.head)) return undefined;
  return tip.out;
}

/** Whether this copy's branch is behind `to` (so a fast-forward is possible). */
export const canFastForward = (git: Git, head: string, to: string) => isAncestor(git, head, to);

/** One line of CHANGES.md: the date it is under and what it says. */
export interface Change {
  date: string;
  text: string;
}

/** The entries of a CHANGES.md: each `- ` line under a `## <date>` heading (a line indented below one continues it). */
export function parseChanges(text: string): Change[] {
  const out: Change[] = [];
  let date = "";
  for (const line of text.split("\n")) {
    const heading = /^##\s+(.+?)\s*$/.exec(line);
    if (heading) {
      date = heading[1]!;
      continue;
    }
    const item = /^[-*]\s+(.+)$/.exec(line);
    if (item && date) out.push({ date, text: item[1]!.trim() });
    else if (/^\s{2,}\S/.test(line) && out.length && date) out[out.length - 1]!.text += ` ${line.trim()}`;
  }
  return out;
}

/** What CHANGES.md says that it did not say in the old version: the lines to print, newest first. */
export function newChanges(git: Git, from: string, to: string): Change[] {
  const read = (commit: string) => {
    const r = git(["show", `${commit}:CHANGES.md`]);
    return r.ok ? parseChanges(r.out) : [];
  };
  const before = new Set(read(from).map((c) => `${c.date}\n${c.text}`));
  return read(to).filter((c) => !before.has(`${c.date}\n${c.text}`));
}

export interface Plan {
  from: string;
  to: string;
  /** How many commits the new version adds. */
  commits: number;
  /** Package folders (from the repo root, "" for the root itself) whose package files changed. */
  installs: string[];
  /** New migration files for the local database. */
  migrations: string[];
  /** Every file the new version changes, adds or removes. */
  changed: string[];
  changes: Change[];
}

const lines = (r: GitResult) => r.out.split("\n").filter(Boolean);

/** What moving from this copy's commit to `to` brings, read from git without changing anything. */
export function plan(git: Git, root: string, head: string, to: string, packageDirs: string[]): Plan {
  const changed = lines(git(["diff", "--name-only", "--no-renames", head, to]));
  const added = lines(git(["diff", "--name-only", "--no-renames", "--diff-filter=A", head, to]));
  // A file the new version brings where the person already has one git does not keep (ignored or not): refused, as
  // the merge would overwrite an ignored one without a word.
  const inTheWay = added.filter((f) => existsSync(join(root, f)));
  if (inTheWay.length) {
    throw new Refusal("file_in_the_way", `The new version brings files where this folder already has files of its own that git does not keep (${listed(inTheWay)}), so opensourcebook update changed nothing, to keep yours. Move them somewhere else and run opensourcebook update again.`);
  }
  const prefix = (dir: string) => (dir ? `${dir}/` : "");
  const installs = packageDirs.filter((dir) => changed.includes(`${prefix(dir)}package-lock.json`) || changed.includes(`${prefix(dir)}package.json`));
  const migrations = added.filter((f) => /^engine\/migrations\/[^/]+\.sql$/.test(f));
  const commits = Number(git(["rev-list", "--count", `${head}..${to}`]).out) || 0;
  return { from: versionOf(git, head), to: versionOf(git, to), commits, installs, migrations, changed, changes: newChanges(git, head, to) };
}

/** Moves the branch forward to `to`, only if that is a fast-forward. */
export function fastForward(git: Git, to: string): GitResult {
  return git(["merge", "--ff-only", "--quiet", to]);
}

/** The branch's newest commit in what `ls-remote` printed, when this copy does not have it yet; else undefined. */
export function newerFrom(lsRemote: string, branch: string, has: (commit: string) => boolean): string | undefined {
  for (const line of lsRemote.split("\n")) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (sha && ref === `refs/heads/${branch}`) return has(sha) ? undefined : sha;
  }
  return undefined;
}

export const NEWER_LINE = '  A newer version of Open Sourcebook is out: "npm run update" (or "opensourcebook update") gets it, and your projects stay as they are.';

/**
 * Whether a newer version is out, for the one quiet line at start. Asks the remote this copy follows, with a short
 * timeout and no prompt; resolves undefined (and prints nothing) when anything is off: not a git checkout, another
 * branch, offline, slow. OPENSOURCEBOOK_UPDATE_CHECK=0 turns it off.
 */
export async function checkForNewer(root: string, options: { timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<string | undefined> {
  const env = options.env ?? process.env;
  if (env.OPENSOURCEBOOK_UPDATE_CHECK === "0") return undefined;
  try {
    const git = gitIn(root, 5_000);
    // Changes of the person's own do not stop the line: opensourcebook update says what to do about them.
    const c = locate(root, git);
    const listedRefs = await lsRemote(root, c.remote, c.branch, options.timeoutMs ?? 3_000);
    if (listedRefs === undefined) return undefined;
    const newer = newerFrom(listedRefs, c.branch, (commit) => git(["cat-file", "-e", `${commit}^{commit}`]).ok && isAncestor(git, commit, c.head));
    return newer ? NEWER_LINE : undefined;
  } catch {
    return undefined;
  }
}

/** How long a log is now, so `newerSaidSince` reads only what a start writes after it. */
export const logSize = (log: string) => (existsSync(log) ? statSync(log).size : 0);

/** The line about a newer version, when a start in the background wrote it to its log after `from`; else undefined. */
export function newerSaidSince(log: string, from: number): string | undefined {
  try {
    return readFileSync(log).subarray(from).toString("utf8").includes(NEWER_LINE.trim()) ? NEWER_LINE.trim() : undefined;
  } catch {
    return undefined;
  }
}

/** The answer of a promise if it is already known, else undefined: the start does not wait for the network. */
export function ifKnown<T>(promise: Promise<T | undefined>): Promise<T | undefined> {
  return Promise.race([promise, new Promise<undefined>((resolve) => setImmediate(() => resolve(undefined)))]);
}

function lsRemote(root: string, remote: string, branch: string, timeoutMs: number): Promise<string | undefined> {
  return new Promise((resolve) => {
    let out = "";
    // detached: no terminal for ssh or a credential helper to ask on; it fails instead, quietly.
    const child = spawn("git", ["-C", root, "ls-remote", "--quiet", remote, `refs/heads/${branch}`], {
      env: { ...process.env, ...GIT_ENV },
      stdio: ["ignore", "pipe", "ignore"],
      detached: true,
      windowsHide: true,
    });
    const timer = setTimeout(() => {
      try {
        // The whole group: git and whatever it started to reach the remote (ssh, a credential helper). On Windows
        // the tree, since git.exe there is a small program that runs the real git under it.
        if (child.pid) signalTree(child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // gone
      }
      // Its output pipe may be held by what it started; it must not keep this process waiting.
      child.stdout.destroy();
      resolve(undefined);
    }, timeoutMs);
    timer.unref();
    child.stdout.on("data", (d: Buffer) => (out += d.toString()));
    child.once("error", () => {
      clearTimeout(timer);
      resolve(undefined);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : undefined);
    });
  });
}
