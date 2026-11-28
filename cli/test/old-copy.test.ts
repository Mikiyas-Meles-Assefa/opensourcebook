/**
 * A copy from before the rename: its command file still answers, a folder with only that file is still known as a
 * copy, and the start its updater asks for finds the old state folder and moves it.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { runCommand, type Io } from "../commands/index.ts";
import { COMMAND_FILE, OLD_COMMAND_FILE, commandIn } from "../commands/run.ts";
import { readRunning } from "../record.ts";
import { readSecrets } from "../secrets.ts";
import { stateFolder } from "../state.ts";
import { runIn } from "./fake-engine.ts";

const ROOT = join(import.meta.dirname, "..", "..");
const base = mkdtempSync(join(tmpdir(), "opensourcebook-old-copy-"));
const started: number[] = [];
after(() => {
  for (const pid of started) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  // Windows keeps a file in use until the process that holds it has fully gone.
  rmSync(base, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
});

function copy(name: string, command: string, script = ""): string {
  const root = join(base, name);
  mkdirSync(join(root, "cli"), { recursive: true });
  mkdirSync(join(root, "engine"), { recursive: true });
  writeFileSync(join(root, "cli", command), script);
  writeFileSync(join(root, "engine", "package.json"), "{}");
  return root;
}

test("the package names one command, opensourcebook, and the old command file is still there and only passes on", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { bin: Record<string, string>; scripts: Record<string, string> };
  assert.deepEqual(pkg.bin, { opensourcebook: `cli/${COMMAND_FILE}` });
  for (const script of ["start", "check", "status", "open", "update"]) assert.match(pkg.scripts[script]!, /^node cli\/opensourcebook\.mjs/, `npm run ${script}`);
  // A folder of its own: the real command never looks at the person's own app data folder from a test.
  const env = { PATH: process.env.PATH, OPENSOURCEBOOK_APP_DATA: join(base, "app-data") };
  const now = spawnSync(process.execPath, [join(ROOT, "cli", COMMAND_FILE), "help"], { encoding: "utf8", env });
  const old = spawnSync(process.execPath, [join(ROOT, "cli", OLD_COMMAND_FILE), "help"], { encoding: "utf8", env });
  assert.equal(now.status, 0, now.stderr);
  assert.equal(old.status, 0, old.stderr);
  assert.match(now.stdout, /^opensourcebook: Open Sourcebook on this computer/);
  assert.equal(old.stdout, now.stdout, "the same words in, the same answer out");
  const bad = spawnSync(process.execPath, [join(ROOT, "cli", OLD_COMMAND_FILE), "nonsense", "--json"], { encoding: "utf8", env });
  assert.equal(bad.status, 1, "and the same exit code");
  assert.equal((JSON.parse(bad.stdout) as { error: { code: string } }).error.code, "unknown_command");
});

test("a folder is known as a copy by its command under either name", async () => {
  const mine = copy("mine", COMMAND_FILE);
  const older = copy("older", OLD_COMMAND_FILE);
  assert.equal(commandIn(mine), join(mine, "cli", COMMAND_FILE));
  assert.equal(commandIn(older), join(older, "cli", OLD_COMMAND_FILE));
  assert.equal(commandIn(join(base, "nothing-here")), undefined);
  const r = await runIn(["stop"], { home: join(mine, ".opensourcebook"), root: mine, cwd: join(older, "engine") });
  assert.equal(r.code, 1);
  assert.match(r.err, /belongs to the Open Sourcebook in .*mine, but you are in the Open Sourcebook in .*older/);
  assert.match(r.err, /older[\\/]cli[\\/]re\.mjs" stop/, "the line to run names the command that copy has");
});

test("the start an updater from before the rename asks for moves the old state folder first, with its tokens, and the launcher is found in the new one", async () => {
  // A stand-in for the launcher: it records itself where the real one would, in the state folder it finds.
  const launcher = `import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const home = join(root, ".opensourcebook");
mkdirSync(home, { recursive: true });
writeFileSync(join(home, "running.json"), JSON.stringify({ pid: process.pid, url: "http://127.0.0.1:1", ports: { web: 1 }, ready: true }));
setInterval(() => {}, 1000);
`;
  const root = copy("updated", COMMAND_FILE, launcher);
  const oldHome = join(root, ".re");
  mkdirSync(join(oldHome, "logs"), { recursive: true });
  writeFileSync(join(oldHome, "secrets.json"), JSON.stringify({ RE_CLIENT_TOKEN: "client-client-client-client", RE_CONNECTOR_TOKEN: "connector-connector-connector", PHONE_TOKEN: "phone-phone-phone-phone" }));
  writeFileSync(join(oldHome, "devices.json"), '{"devices":[{"id":"d1"}]}');
  writeFileSync(join(oldHome, "logs", "launcher.log"), "what the old launcher said\n");

  let out = "";
  const said: string[] = [];
  const env = { PATH: process.env.PATH };
  const io: Io = {
    stdout: (t) => (out += `${t}\n`),
    stderr: (t) => said.push(t),
    env,
    cwd: root,
    root,
    // As the real command does it: found where it is, and moved only by a start.
    home: stateFolder(root, env),
    settle: (say) => stateFolder(root, env, { settle: true, say }),
    pollMs: 5,
  };
  assert.equal(io.home, oldHome, "before the start, the old folder is read where it is");
  assert.equal(await runCommand(["status", "--json"], io), 1);
  assert.ok(lstatSync(oldHome).isDirectory() && !existsSync(join(root, ".opensourcebook")), "a status moves nothing");

  out = "";
  const code = await runCommand(["start", "--background", "--json", "--no-open"], io);
  const answer = JSON.parse(out.trim().split("\n").pop()!) as { ok: boolean; url: string; pid: number; already: boolean };
  started.push(answer.pid);
  assert.equal(code, 0, said.join("\n"));
  assert.deepEqual({ ok: answer.ok, url: answer.url, already: answer.already }, { ok: true, url: "http://127.0.0.1:1", already: false });

  const home = join(root, ".opensourcebook");
  assert.match(said.join("\n"), /moved from \.re\/ to \.opensourcebook\//);
  assert.equal(readRunning(home)?.pid, answer.pid);
  assert.equal(readSecrets(join(home, "secrets.json"))?.OPENSOURCEBOOK_CLIENT_TOKEN, "client-client-client-client");
  assert.equal(readSecrets(join(home, "secrets.json"))?.OPENSOURCEBOOK_CONNECTOR_TOKEN, "connector-connector-connector");
  assert.equal(readFileSync(join(home, "devices.json"), "utf8"), '{"devices":[{"id":"d1"}]}', "the paired devices came along");
  const log = readFileSync(join(home, "logs", "launcher.log"), "utf8");
  assert.match(log, /^what the old launcher said\n/, "the log goes on where it was");
  assert.match(log, /opensourcebook start --background.*\n  Your settings moved from \.re\/ to \.opensourcebook\//, "and says what became of the old folder");
  if (process.platform !== "win32") assert.equal(readRunning(oldHome)?.pid, answer.pid, "the updater that is still running finds the launcher under the old name too");
});
