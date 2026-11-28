# Contributing to Open Sourcebook

Everyone is welcome here, and you are encouraged to open a pull request. Fix what is broken, add what you think is missing (a style, a piece, an agent, a voice, a fix for your system), or report a bug. Open Sourcebook is built by one person, so small, clear changes are the easiest to say yes to.

## What helps most

- **A good bug report.** Say what you did, what you saw and what you expected. The issue forms ask for what we need.
- **Trying it where it is not proven.** Windows, Linux, a real phone, and the agents beyond Claude Code and Codex ([`docs/LIMITS.md`](docs/LIMITS.md) says what has been run for real).
- **A better video.** A bad video is worth a report, and a new piece or style makes every video better.
- **More variety.** A style, a piece, a kind of card, a kind of quiz question, a skill, a pack, an agent or a voice is one file or one folder each. The steps for each are in [`docs/EXTENDING.md`](docs/EXTENDING.md).
- **Clearer words.** The README, the guides and the words on screen.

Work is tracked as issues. The labels are `bug`, `install`, `video`, `idea`, `docs`, `agents`, `platform`, `good first issue` and `help wanted`, and [`.github/labels.yml`](.github/labels.yml) says what each is for. `good first issue` and `help wanted` mark the ones that are ready for someone new. A bug fix, a clearer error message or a test is welcome without asking first. For something bigger, open an issue first and say what you want to change.

A security problem is reported privately, not in an issue: [`SECURITY.md`](SECURITY.md). How we treat each other is in [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).

## Set up

You need Node 24, ffmpeg and a clone (the one-line install in the README is for using Open Sourcebook, not for changing it):

```bash
git clone https://github.com/Mikiyas-Meles-Assefa/opensourcebook.git
cd opensourcebook
npm start            # installs, sets up and starts the four programs, on the app data folder the desktop app uses too
npm start -- --dev   # the engine and the web app reload as you save
npm start -- --data /tmp/osb --ports-from 9100   # a private copy with its own projects, beside the one you use
npm run check        # what this computer is missing
```

More on running a clone is in [`docs/DEVELOPING.md`](docs/DEVELOPING.md). [`AGENTS.md`](AGENTS.md) says how the repo works, for people and coding agents alike, and [`docs/STRUCTURE.md`](docs/STRUCTURE.md) says where things live.

## The checks

Run the ones for what you changed, each from its own folder after `npm install` there, and make them pass before you open a pull request. Continuous checks run the same ones.

| Where | Commands |
|---|---|
| Root (the launcher in `cli/`) | `npm run typecheck`, `npm test` |
| `engine/` | `npm run typecheck`, `npm test` |
| `web/` | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` |
| `services/agent-connector/` | `npm run typecheck`, `npm test` |
| `services/scenes/` | `npm run browser` (once, downloads headless Chrome, about 180 MB), `npm run typecheck`, `npm test` |
| `install/package/` (the one-line install) | `npm test`; [`install/README.md`](install/README.md) says how to try the whole line in a throwaway home folder |

Add a test for what you add. Try it for real too, and say what you tried.

## Sending a change

1. Pick an open issue, or open one, and say you are on it in a comment.
2. Make the change in small commits. One concern per commit, and each commit passes its program's checks.
3. Open a pull request that says what it does, how you checked it and what is left open, and names the issue it closes (`Closes #12`; `Refs #12` when it only moves it on).

## The few rules

- **Commit messages.** One plain sentence with a word for the area first: `Engine: ...`, `Web: ...`, `Scenes: ...`, `Connector: ...`, `Launcher: ...`, `Docs: ...`, `Skills: ...`, `Decisions: ...`. Say what is true now, not what you did. For example: `Scenes: a heatmap piece, a grid of values shaded by size that fills row by row`.
- **Nothing private or built.** No secrets (`.env`, `.dev.vars`, tokens, cookies, the app data folder, an older clone's `.opensourcebook/`), no build output and no generated videos.
- **Its own words.** No other product is named as the source of an idea ([`AGENTS.md`](AGENTS.md) has the rule in full).
- **What is new.** When a person using Open Sourcebook would notice the change, add one line at the top of [`CHANGES.md`](CHANGES.md) under today's date (a heading such as `## 2026-11-19`; add it if it is not there): `- ` and a plain sentence on what they can now do. An update prints these lines to people, so never edit or reorder older ones. A tagged version has its notes in [`docs/RELEASES.md`](docs/RELEASES.md); a change worth a line there goes under Unreleased.
- **Decisions.** A change that settles something lasting (a rule for how Open Sourcebook works, what a new kind of thing means, what it may do on someone's computer, a change of direction) adds a row at the end of [`docs/DECISIONS.md`](docs/DECISIONS.md), with the next free number, saying what changed and why. A new style, piece, agent or example does not need one.
- **Licence.** By contributing you agree that your contribution is under the project's licence, MIT ([`LICENSE`](LICENSE)).

## Using AI

- Using AI to contribute is welcome.
- Whether to say so is the pull request author's choice; say it in the pull request description if you like.
- Keep commit messages free of tool lines (no `Co-Authored-By` or "generated with"), because they stay in the history for good.
- Top-performing models are appreciated, such as Fable 5.2, Opus 5.5, Gemini 4 Neon and the likes.
