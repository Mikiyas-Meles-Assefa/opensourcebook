# Starting Open Sourcebook on a Mac with nothing on it

What a person meets running `npm start` on a Mac that has none of the usual tools, in the words Open Sourcebook prints. The lines below are copied from the automated check on a fresh GitHub-hosted Mac (`.github/workflows/clean-mac.yml`), which clones the repo with `--depth 1`, runs `npm start`, waits for the four programs, and stops Open Sourcebook. It runs on pull requests that touch the install path, by hand, and every week.

## What the fresh Mac had

macOS 15 on Apple silicon, Homebrew present, no ffmpeg, no coding agent, no browser for videos, and a Node older than 24. The shallow clone was 29 MB. The first start, with an empty package cache, took 25 seconds to "Open Sourcebook is running", including the browser for videos (570 MB in `~/Library/Caches/opensourcebook-scenes`).

## Node is older than 24

Nothing starts. Open Sourcebook says:

```
Open Sourcebook needs Node 24 or newer, and this is Node 22.23.4. Install Node 24 from nodejs.org (or run "nvm install 24"), then run this again.
```

Install Node 24, check it with `node --version`, run `npm start` again.

## There is no ffmpeg (and no Homebrew)

`npm start` and `npm run check` print this, and Open Sourcebook still starts. Without ffmpeg, videos cannot be made; everything else works.

```
fix   ffmpeg is missing, so videos can't be made: install it with `brew install ffmpeg` (Homebrew is at brew.sh; without it, download ffmpeg from ffmpeg.org/download.html), then start again. `ffmpeg -version` says whether it is there.
```

With Homebrew: `brew install ffmpeg`. Without it: download ffmpeg from ffmpeg.org/download.html and put it on your PATH. Then `ffmpeg -version` should answer, and you start Open Sourcebook again. Open Sourcebook never installs Homebrew for you.

## No coding agent is installed

Open Sourcebook starts and says so twice, once in the check and once next to the agent connector:

```
note  Open Sourcebook works with Claude Code, Codex, OpenCode, Antigravity, Cursor and GitHub Copilot; none is installed here.
fix   No coding agent is ready, so the chat can't answer: install Claude Code and sign in with `claude auth login`.
...
Agent connector  ready  http://127.0.0.1:9100  (no signed-in agent, the chat can't answer)
```

Install Claude Code (or Codex, OpenCode, Antigravity, Cursor or GitHub Copilot), sign in, and start Open Sourcebook again. `npm run status` shows the same words while Open Sourcebook runs. The other three programs are up and Open Sourcebook opens; only the making needs an agent. A model API key in `engine/.dev.vars` is the other way (see [`INSTALL.md`](INSTALL.md)).

## An agent is installed but you are not signed in

```
fix   Claude Code 2.1.327 is installed but not signed in: run `claude auth login` in a terminal.
```

Run that command, then start Open Sourcebook again. Open Sourcebook starts anyway and the connector says `(no signed-in agent, the chat can't answer)`.

## The first start, in order

```
Checking this computer
  note  The browser that draws videos is not downloaded yet; starting Open Sourcebook downloads it once (about 180 MB to download, about half a gigabyte once unpacked).
  note  What the Agent connector, Video scenes, Engine, Web app need is not installed yet; starting Open Sourcebook installs it once (a few minutes).
  Installing 4 parts of Open Sourcebook (first run, a few minutes): done in 8s
  Made the passwords Open Sourcebook's programs use to talk to each other, once. They are kept in /Users/you/Library/Application Support/Open Sourcebook/state/secrets.json, which only you can read and which is never committed.
  Downloading the browser that draws videos (once; about 180 MB to download, about half a gigabyte once unpacked): done
  Setting up where your projects are kept (a database on this computer): done

Starting
  Agent connector  ready  http://127.0.0.1:9100  (no signed-in agent, the chat can't answer)
  Video scenes     ready  http://127.0.0.1:9101  (voice: No voice (made without sound))
  Engine           ready  http://127.0.0.1:9102
  Web app          ready  http://127.0.0.1:9104

Open Sourcebook is running at http://127.0.0.1:9104
```

The "No voice" words are normal without an ElevenLabs key: videos have captions and no sound. The ports above are from `--ports-from 9100`; by default Open Sourcebook uses its usual ones, and swaps a taken one for a free one.

## Stopping

Ctrl-C, or `opensourcebook stop` from another terminal. The last line is:

```
Stopped. Nothing of Open Sourcebook is left running.
```
