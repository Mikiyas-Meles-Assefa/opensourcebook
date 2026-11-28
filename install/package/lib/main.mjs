/**
 * The `opensourcebook` command: install, update, where, and everything else handed to the app itself.
 * Every function takes what it needs (the home folder, the archive address, the runner for other programs), so
 * the tests run it without the network and without a real app.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isInstalled, isRunning, openApp, runApp, startApp, stopApp } from "./app.mjs";
import { updateApp } from "./archive.mjs";
import { PACKAGE_DIR, archiveOf, homeOf, layout } from "./paths.mjs";
import { Problem, told } from "./problem.mjs";
import { runProcess } from "./run.mjs";
import { copyLauncher, writeShims } from "./shims.mjs";
import { makeShortcut } from "./shortcuts.mjs";
import { ensureTools } from "./tools.mjs";

/** What a command line asks for. Only `install`, `update`, `where` and no words at all are this package's; the rest is the app's. */
export function route(argv, installed) {
  const [first, ...rest] = argv;
  if (first === undefined) return installed ? { kind: "launch" } : { kind: "install", flags: {} };
  if (first === "install") return { kind: "install", flags: installFlags(rest) };
  if (first === "update") return { kind: "update" };
  if (first === "where") return { kind: "where" };
  return { kind: "app", args: argv };
}

export function installFlags(words) {
  const flags = {};
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    if (word === "--no-start") flags.noStart = true;
    else if (word === "--no-open") flags.noOpen = true;
    else if (word === "--ports-from" || word.startsWith("--ports-from=")) {
      const port = Number(word.includes("=") ? word.slice(word.indexOf("=") + 1) : words[++i]);
      if (!Number.isInteger(port) || port < 1024 || port > 65000) throw new Problem("--ports-from needs a number between 1024 and 65000.", "Run the command again with a number such as 9300 after --ports-from.");
      flags.portsFrom = port;
    } else throw new Problem(`"${word}" is not something "opensourcebook install" understands.`, "Run it again with only --no-start, --no-open or --ports-from.");
  }
  return flags;
}

/** The ports a person asked for at install are remembered, so every later start uses the same ones. */
function readSettings(home) {
  try {
    return JSON.parse(readFileSync(layout(home).settings, "utf8"));
  } catch {
    return {};
  }
}

function fill(deps) {
  const env = deps.env ?? process.env;
  const userHome = deps.userHome ?? homedir();
  return {
    env,
    userHome,
    home: deps.home ?? homeOf(env, userHome),
    archive: deps.archive ?? archiveOf(env, deps.packageDir ?? PACKAGE_DIR),
    packageDir: deps.packageDir ?? PACKAGE_DIR,
    run: deps.run ?? runProcess,
    fetchImpl: deps.fetchImpl ?? fetch,
    platform: deps.platform ?? process.platform,
    arch: deps.arch ?? process.arch,
    execPath: deps.execPath ?? process.execPath,
    cwd: deps.cwd ?? process.cwd(),
    say: deps.say ?? ((line) => console.log(line)),
    warn: deps.warn ?? ((line) => console.error(line)),
  };
}

export async function install(d, flags) {
  const at = layout(d.home);
  const had = isInstalled(d.home);
  const shortcut = d.env.OPENSOURCEBOOK_NO_SHORTCUT === "1" ? "" : d.platform === "darwin" ? ", apart from an Open Sourcebook shortcut in your Applications folder" : d.platform === "linux" ? ", apart from an Open Sourcebook entry in your apps menu" : "";
  d.say(had ? `Open Sourcebook will be updated in ${d.home}, from ${d.archive}.` : `Open Sourcebook will be downloaded from ${d.archive} into ${d.home}.`);
  d.say(`Nothing outside that folder is changed${shortcut}, and your projects are kept.`);
  try {
    mkdirSync(d.home, { recursive: true });
  } catch (error) {
    throw new Problem(`The folder ${d.home} could not be made.`, "Check that you may write in your home folder and run the same command again.", error);
  }

  await updateApp({
    ...d,
    beforeChange: async () => {
      if (had && (await stopApp(d))) d.say("Stopped the running Open Sourcebook to update it.");
    },
  });

  try {
    copyLauncher(d.home, d.packageDir);
    writeShims(d.home, d.platform);
  } catch (error) {
    throw new Problem(`The opensourcebook command could not be written in ${at.bin}.`, "Check that you may write in that folder and run the same command again.", error);
  }

  const tools = await ensureTools(d);
  if (tools.warning) d.warn(`Note: ${tools.warning}`);
  if (tools.detail && d.env.OPENSOURCEBOOK_DEBUG) d.warn(tools.detail);

  try {
    const made = makeShortcut(d);
    if (made) d.say(`Made the shortcut ${made}.`);
  } catch (error) {
    d.warn(`Note: the shortcut could not be made, so open Open Sourcebook by running "${at.bin}/opensourcebook" instead.`);
    if (d.env.OPENSOURCEBOOK_DEBUG) d.warn(String(error));
  }

  if (flags.portsFrom) writeFileSync(at.settings, `${JSON.stringify({ portsFrom: flags.portsFrom }, null, 2)}\n`);
  else rmSync(at.settings, { force: true });

  if (flags.noStart) {
    d.say('Open Sourcebook is installed and not started; run "opensourcebook" to start it.');
    return 0;
  }
  d.say(had ? "Starting Open Sourcebook again." : "Starting Open Sourcebook for the first time, which takes a few minutes while it gets its parts.");
  await startApp(d, flags.portsFrom);
  if (!flags.noOpen) await openApp(d);
  d.say('Open Sourcebook is installed and running; next time, open it with the Open Sourcebook shortcut or by running "opensourcebook".');
  return 0;
}

export async function update(d) {
  if (!isInstalled(d.home)) throw new Problem("Open Sourcebook is not installed yet.", 'Run "opensourcebook install" first.');
  d.say(`Open Sourcebook will be updated in ${d.home}, from ${d.archive}.`);
  let wasRunning = false;
  const result = await updateApp({
    ...d,
    beforeChange: async () => {
      wasRunning = await stopApp(d);
      if (wasRunning) d.say("Stopped the running Open Sourcebook to update it.");
    },
  });
  d.say(`Open Sourcebook is up to date (${result.files} files, ${result.removed} old ones removed), and your projects were kept.`);
  if (wasRunning) {
    d.say("Starting Open Sourcebook again.");
    await startApp(d, readSettings(d.home).portsFrom);
  }
  return 0;
}

export async function launch(d) {
  if (!(await isRunning(d))) await startApp(d, readSettings(d.home).portsFrom);
  await openApp(d);
  return 0;
}

export async function passToApp(d, args) {
  if (!isInstalled(d.home)) throw new Problem("Open Sourcebook is not installed yet.", 'Run "opensourcebook install" first.');
  const result = await runApp({ ...d, args, cwd: d.cwd });
  return result.code;
}

/** Runs one command line and resolves with the exit code. Never throws: a failure is one sentence and one next step. */
export async function main(argv, deps = {}) {
  let d;
  try {
    d = fill(deps);
    const asked = route(argv, isInstalled(d.home));
    if (asked.kind === "install") return await install(d, asked.flags);
    if (asked.kind === "update") return await update(d);
    if (asked.kind === "launch") return await launch(d);
    if (asked.kind === "where") {
      d.say(`Open Sourcebook lives in ${d.home}.`);
      d.say(`It is downloaded from ${d.archive}.`);
      return 0;
    }
    return await passToApp(d, asked.args);
  } catch (error) {
    const env = deps.env ?? process.env;
    const warn = d?.warn ?? deps.warn ?? ((line) => console.error(line));
    if (env.OPENSOURCEBOOK_DEBUG) warn(error?.stack ?? String(error));
    if (env.OPENSOURCEBOOK_DEBUG && error?.cause) warn(`Cause: ${error.cause?.stack ?? error.cause}`);
    warn(error instanceof Problem ? told(error) : `Open Sourcebook ran into a problem (${error?.message ?? error}). Run the same command again.`);
    return 1;
  }
}
