import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { engineState, useAppData } from "../app-data.ts";
import { PROGRAMS, type Wiring } from "../programs.ts";
import { SECRET_NAMES, type Secrets } from "../secrets.ts";
import { stateFolder } from "../state.ts";

const secrets = Object.fromEntries(SECRET_NAMES.map((n) => [n, `${n.toLowerCase()}-0123456789`])) as Secrets;
const ports = { engine: 9003, web: 9004, connector: 9000, scenes: 9002, "engine-inspector": 9005 };
const dir = mkdtempSync(join(tmpdir(), "opensourcebook-app-data-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const root = join(dir, "app");
const data = join(dir, "Application Support", "Open Sourcebook");
mkdirSync(join(root, "engine"), { recursive: true });
mkdirSync(join(root, ".opensourcebook"), { recursive: true });
mkdirSync(join(data, "state"), { recursive: true });

test("with an app data folder, the state, the engine's data and the video jobs are in it, and the connector may work in the jobs folder", () => {
  const env: NodeJS.ProcessEnv = { OPENSOURCEBOOK_APP_DATA: data };
  useAppData(env);
  assert.equal(env.OPENSOURCEBOOK_STATE, join(data, "state"));
  assert.equal(env.SCENES_JOBS_DIR, join(data, "jobs"));
  assert.equal(env.SCENES_DATA_DIR, join(data, "scenes"));
  assert.equal(stateFolder(root, env), join(data, "state"));
  assert.equal(engineState(join(root, "engine"), env), join(data, "data"));
  const w: Wiring = { root, home: join(data, "state"), ports, secrets, env };
  const program = (id: string) => PROGRAMS.find((p) => p.id === id)!;
  assert.equal(program("connector").start(w).env.OPENSOURCEBOOK_CONNECTOR_SCENES_ROOTS, join(data, "jobs"));
  assert.equal(program("scenes").start(w).env.SCENES_ENGINE_URL, "http://127.0.0.1:9003");
  const dev = program("engine").start(w).args;
  assert.equal(dev[dev.indexOf("--persist-to") + 1], join(data, "data"));
});

test("without one, everything stays where a clone always kept it, and a setting named on its own still wins", () => {
  const env: NodeJS.ProcessEnv = {};
  useAppData(env);
  assert.deepEqual(env, {});
  assert.equal(engineState(join(root, "engine"), env), join(root, "engine", ".wrangler", "state"));
  const w: Wiring = { root, home: join(root, ".opensourcebook"), ports, secrets, env };
  assert.ok(!PROGRAMS.find((p) => p.id === "engine")!.start(w).args.includes("--persist-to"));
  assert.equal(PROGRAMS.find((p) => p.id === "connector")!.start(w).env.OPENSOURCEBOOK_CONNECTOR_SCENES_ROOTS, join(root, "services", "scenes", ".data"));

  const named: NodeJS.ProcessEnv = { OPENSOURCEBOOK_APP_DATA: data, SCENES_DATA_DIR: "/elsewhere/jobs" };
  useAppData(named);
  assert.equal(named.SCENES_DATA_DIR, "/elsewhere/jobs");
  assert.equal(named.SCENES_JOBS_DIR, undefined);
  assert.equal(named.OPENSOURCEBOOK_STATE, join(data, "state"));
});

test("every copy uses this system's own app data folder unless --data or the setting names another, and a test must name its own", async () => {
  const { appDataFolder, chooseAppData, usualAppData } = await import("../app-data.ts");
  assert.equal(appDataFolder("darwin", {}, "/Users/ana"), "/Users/ana/Library/Application Support/Open Sourcebook");
  assert.equal(appDataFolder("linux", {}, "/home/ana"), "/home/ana/.local/share/Open Sourcebook");
  assert.equal(appDataFolder("linux", { XDG_DATA_HOME: "/data" }, "/home/ana"), "/data/Open Sourcebook");
  assert.equal(appDataFolder("win32", { APPDATA: "C:\\Users\\ana\\AppData\\Roaming" }, "C:\\Users\\ana"), "C:\\Users\\ana\\AppData\\Roaming\\Open Sourcebook");

  const flag: NodeJS.ProcessEnv = { OPENSOURCEBOOK_APP_DATA: "/named" };
  const chosen = chooseAppData(["--no-open", "--data", "scratch", "--ports-from", "9100"], flag, "/work", "darwin", "/Users/ana");
  assert.deepEqual(chosen, { argv: ["--no-open", "--ports-from", "9100"], root: join("/work", "scratch"), usual: false }, "--data wins over the setting and leaves the line");
  assert.equal(flag.OPENSOURCEBOOK_APP_DATA, join("/work", "scratch"), "and is named for every program started from here");
  assert.throws(() => chooseAppData(["--data"], {}, "/work"), /--data takes a folder/);

  const named: NodeJS.ProcessEnv = { OPENSOURCEBOOK_APP_DATA: "/named", NODE_TEST_CONTEXT: "child" };
  assert.deepEqual(chooseAppData(["status"], named, "/work", "darwin", "/Users/ana"), { argv: ["status"], root: "/named", usual: false });
  assert.equal(usualAppData(), undefined, "a named folder is never the one old data is moved into");

  assert.throws(() => chooseAppData([], { NODE_TEST_CONTEXT: "child-v8" }, "/work", "darwin", "/Users/ana"), /A test never uses the person's real app data folder/);

  const plain: NodeJS.ProcessEnv = {};
  assert.deepEqual(chooseAppData(["--ports-from", "9100"], plain, "/work", "darwin", "/Users/ana"), { argv: ["--ports-from", "9100"], root: "/Users/ana/Library/Application Support/Open Sourcebook", usual: true }, "--ports-from alone never changes where the data is");
  assert.equal(plain.OPENSOURCEBOOK_APP_DATA, "/Users/ana/Library/Application Support/Open Sourcebook");
  assert.equal(usualAppData(), "/Users/ana/Library/Application Support/Open Sourcebook");
});
