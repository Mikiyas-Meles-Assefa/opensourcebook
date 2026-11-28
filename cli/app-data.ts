/**
 * The app data folder (docs/JOB-FOLDER.md): the one folder where Open Sourcebook keeps everything of a person's that is
 * not the programs, the same for the desktop app, the one-line install and a clone started with `npm start`, so a person
 * never has their projects in two places:
 *
 *   macOS    ~/Library/Application Support/Open Sourcebook
 *   Windows  %APPDATA%\Open Sourcebook
 *   Linux    $XDG_DATA_HOME/Open Sourcebook, else ~/.local/share/Open Sourcebook
 *
 * OPENSOURCEBOOK_APP_DATA, or `--data <folder>` on the command line, names another one (a scratch copy, a test). Inside
 * it, `state/` is the launcher's state folder, `data/` the engine's saved projects and files, `jobs/` the job folders,
 * one per video, and `scenes/` the scenes service's other files. A setting named on its own (OPENSOURCEBOOK_STATE,
 * SCENES_JOBS_DIR, SCENES_DATA_DIR) still wins.
 *
 * This file is the one place that says where the folder is: the desktop app (desktop/src/paths.ts) uses it too, so it
 * needs nothing but Node's own modules.
 */
import { homedir } from "node:os";
import { join, resolve, win32 } from "node:path";

export const APP_NAME = "Open Sourcebook";
export const APP_DATA_ENV = "OPENSOURCEBOOK_APP_DATA";
export const DATA_FLAG = "--data";
/** The folders inside the app data folder, by what they hold. */
export const IN_APP_DATA = { state: "state", data: "data", jobs: "jobs", scenes: "scenes" } as const;

/** The app data folder, when one is named. */
export function appDataOf(env: NodeJS.ProcessEnv): string | undefined {
  return env[APP_DATA_ENV]?.trim() || undefined;
}

/** The app data folder: the one named in OPENSOURCEBOOK_APP_DATA, else this system's own place for an app's data. */
export function appDataFolder(platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const named = appDataOf(env);
  if (named) return named;
  if (platform === "darwin") return join(home, "Library", "Application Support", APP_NAME);
  if (platform === "win32") return win32.join(env.APPDATA?.trim() || win32.join(home, "AppData", "Roaming"), APP_NAME);
  return join(env.XDG_DATA_HOME?.trim() || join(home, ".local", "share"), APP_NAME);
}

/** The app data folder of this run when it is this system's usual one (chooseAppData), the only one a copy's old data is moved into. */
let usual: string | undefined;
export const usualAppData = (): string | undefined => usual;

export interface Chosen {
  /** The command line without `--data <folder>`. */
  argv: string[];
  root: string;
  /** True when the folder is this system's own place, not one named by the setting or the flag. */
  usual: boolean;
}

/**
 * Settles the app data folder for this run and names it in OPENSOURCEBOOK_APP_DATA, so every program and every launcher
 * started from here uses the same one: `--data <folder>` first (taken out of the command line), then the setting, then
 * this system's own place. A test run (node's test runner says so in NODE_TEST_CONTEXT) must name its own folder: it
 * never falls back to the person's real one.
 */
export function chooseAppData(argv: string[], env: NodeJS.ProcessEnv, cwd = process.cwd(), platform: NodeJS.Platform = process.platform, home = homedir()): Chosen {
  const at = argv.indexOf(DATA_FLAG);
  if (at !== -1) {
    const folder = argv[at + 1]?.trim();
    if (!folder || folder.startsWith("--")) throw new Error(`${DATA_FLAG} takes a folder: where this copy keeps its projects and settings, instead of the app's usual one.`);
    env[APP_DATA_ENV] = resolve(cwd, folder);
    return { argv: [...argv.slice(0, at), ...argv.slice(at + 2)], root: env[APP_DATA_ENV]!, usual: false };
  }
  const named = appDataOf(env);
  if (named) return { argv, root: named, usual: false };
  if (env.NODE_TEST_CONTEXT) throw new Error(`A test started Open Sourcebook without a folder of its own: set ${APP_DATA_ENV} (or pass ${DATA_FLAG}) to a scratch folder. A test never uses the person's real app data folder.`);
  env[APP_DATA_ENV] = appDataFolder(platform, env, home);
  usual = env[APP_DATA_ENV];
  return { argv, root: env[APP_DATA_ENV]!, usual: true };
}

/** Points the state folder and the scenes service's folder into the app data folder, unless each is named already. */
export function useAppData(env: NodeJS.ProcessEnv): void {
  const root = appDataOf(env);
  if (!root) return;
  if (!env.OPENSOURCEBOOK_STATE?.trim()) env.OPENSOURCEBOOK_STATE = join(root, IN_APP_DATA.state);
  if (!env.SCENES_JOBS_DIR?.trim() && !env.SCENES_DATA_DIR?.trim()) env.SCENES_JOBS_DIR = join(root, IN_APP_DATA.jobs);
  if (!env.SCENES_DATA_DIR?.trim()) env.SCENES_DATA_DIR = join(root, IN_APP_DATA.scenes);
}

/** Where the engine keeps its local database, queue and files (what `--persist-to` names): `data/` in the app data folder, else beside the engine. */
export function engineState(engineDir: string, env: NodeJS.ProcessEnv = process.env): string {
  const root = appDataOf(env);
  return root ? join(root, IN_APP_DATA.data) : join(engineDir, ".wrangler", "state");
}
