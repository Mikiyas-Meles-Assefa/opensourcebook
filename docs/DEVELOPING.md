# Working from a clone

To change Open Sourcebook itself. How to send a change is in [`CONTRIBUTING.md`](../CONTRIBUTING.md), and how to add a style, a piece, an agent and the rest is in [`EXTENDING.md`](EXTENDING.md).

```bash
git clone --depth 1 https://github.com/Mikiyas-Meles-Assefa/opensourcebook.git
cd opensourcebook
npm start
```

A clone needs these, each checked with one command:

- **Node 24**: `node --version`. Get it from [nodejs.org](https://nodejs.org).
- **ffmpeg**, which videos need: `ffmpeg -version`. On a Mac with [Homebrew](https://brew.sh), `brew install ffmpeg`.
- **An agent, signed in the normal way**: `claude --version`, or the same for another agent in [the table of agents](LIMITS.md#supported-agents).
- **A Mac.** Linux is only partly tried and Windows is not tested yet; help is wanted.

What you meet on a Mac with no Node 24, ffmpeg, Homebrew or signed-in agent, in the words Open Sourcebook prints: [`docs/CLEAN-MAC.md`](CLEAN-MAC.md).

You can run `npm start` straight away: the first thing it does is check this computer, and it says in plain words what is missing and what to do about it. The first start takes a few minutes on a fresh computer and under a minute after that. It:

1. checks this computer and says in plain words what is missing;
2. installs what each of the four programs needs, and prints a line as each one is ready with how long it took;
3. makes the passwords the programs use to talk to each other, kept in the app data folder (only you can read them; below);
4. sets up the database where your projects are kept, on this computer only, in the same folder;
5. downloads the browser that videos are drawn with (once, so the first video does not wait for it): about 180 MB to download and about half a gigabyte once unpacked. On a Mac it is kept in one place, `~/Library/Caches/opensourcebook-scenes`, and nowhere else;
6. builds the engine and the web app ("Getting Open Sourcebook ready", a few seconds, once after each update);
7. starts the four programs, waits until each answers, and opens the web app in your browser with an address that lets that browser in (once; `npm run open` makes another, and `--no-open` prints one instead).

Later starts skip the install steps and the build. Ctrl-C stops everything. If one program stops by itself it is started again while the rest keeps running; every stop says why, with the time, on the screen and in `state/logs/stops.log` in the app data folder.

In a clone, `npm start`, `npm run check`, `npm run status`, `npm run open`, `npm run devices` and `npm run update` are the same as `opensourcebook start`, `check`, `status`, `open`, `device list` and `update`. Run `npm link` once in the folder to put `opensourcebook` on your PATH (without it, `node <the folder>/cli/opensourcebook.mjs` does the same). With several copies on one computer, the command belongs to the folder you ran `npm link` in; run `node cli/opensourcebook.mjs stop` inside the other copy (a start or stop typed inside another copy's folder does nothing and says so).

- `npm start -- --phone` lets a phone on the same Wi-Fi open it ([`PHONE.md`](PHONE.md)).
- `npm start -- --no-open` does not open the browser, and `npm start -- --ports-from 9100` uses ports from 9100 up. A port that is taken is swapped for a free one.
- `npm start -- --data <folder>` keeps projects and settings in that folder instead of the app data folder: a private copy to try things in, with nothing of your own projects in it. `OPENSOURCEBOOK_APP_DATA=<folder>` does the same for every command. `--ports-from` alone never changes where the data is.
- `npm start -- --dev` is for changing Open Sourcebook itself: the engine and the web app run in their watching dev servers and reload when you save. Without it they run from a build made once after each update, which starts faster, uses less memory and is never restarted by a file change.

**Updating a clone.** `npm run update` gets the newest version, installs again only what changed, restarts Open Sourcebook if it was running and prints what is new ([`CHANGES.md`](../CHANGES.md)); `opensourcebook update --check` only says whether there is one and what it brings. Your projects, settings and `.env` files stay as they are, and the database where your projects are kept takes any new steps by itself at the next start. It works on the shallow clone above and keeps it shallow. Open Sourcebook also says at start, in one quiet line, when a newer version is out, and nothing when it cannot reach the network. It only ever moves your copy forward: if your copy has changes of its own, is on another branch or has commits of its own, it changes nothing and says what to do.

**Where your projects are kept.** Every copy of Open Sourcebook on one computer, the desktop app, the one-line install and a clone started with `npm start`, keeps everything of yours in one app data folder, so you never have your projects in two places:

| System | The app data folder |
| --- | --- |
| macOS | `~/Library/Application Support/Open Sourcebook` |
| Windows | `%APPDATA%\Open Sourcebook` |
| Linux | `$XDG_DATA_HOME/Open Sourcebook`, else `~/.local/share/Open Sourcebook` |

Inside it, `state/` holds the secrets, paired devices, voice, builds and logs, `data/` the database and files of your projects, `jobs/` a folder per video and `scenes/` the video service's other files ([`JOB-FOLDER.md`](JOB-FOLDER.md)). A clone used to keep these in its own folder (`.opensourcebook/`, `engine/.wrangler/state`, `services/scenes/.data`). The first start after updating moves them into the app data folder once, when that folder has no projects yet, and says so in one line. When it has projects already (the desktop app was used first), nothing is moved, merged or deleted: one line says the clone's old folders are no longer used, and you can delete them yourself once you are sure.

**The desktop app and a clone at once.** They share one running copy. `npm start` while the desktop app runs opens that copy in your browser instead of starting a second, and the desktop app opened while a clone's copy runs shows that copy in its window. Quitting the desktop app then only closes its window and leaves the clone's copy running; Ctrl-C in the clone's terminal stops it. To try your own changes while the desktop app runs, start the clone with `--data <folder>` and `--ports-from 9100`.

**A copy from before the name changed.** Open Sourcebook used to keep its private files in a folder named `.re/`. An older copy's `.re/` is picked up automatically at the next start, with its settings, paired phones and voice, and older setting names that began with `RE_` are still read. The repository's address is now `github.com/Mikiyas-Meles-Assefa/opensourcebook`.

## Where things are

| | |
|---|---|
| `engine/`, `web/`, `services/agent-connector/`, `services/scenes/` | The four programs. Each has a README. |
| `cli/` | The launcher that starts the four programs, and the `opensourcebook` command (`cli/commands/`). |
| `install/` | The one-line install: the npm package `opensourcebook` and the site that serves the line. |
| `skills/`, `services/scenes/skills/` | What the agent reads: the planner, the notebook (flashcards and quiz), listening (audio) and guide skills, the video skills, and `skills/opensourcebook` for your own agent driving Open Sourcebook with the command. |
| `packs/` | Packs: one folder per kind of work, turned on per project. |
| `services/scenes/pieces/`, `styles/`, `fonts/` | The shelf of pieces, the styles and the fonts that ship with them. |
| `examples/` | Finished example projects. |
| `ios/` | The iPhone app: the app, its share extension, its tests and the Xcode project. |
| `services/ytdlp-sidecar/` | An optional container that reads video and audio sources. |
| `docs/` | The vision, the structure, decisions with their reasons, the glossary, the plan. Start at [`STRUCTURE.md`](STRUCTURE.md). |
