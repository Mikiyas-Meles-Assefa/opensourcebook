# Open Sourcebook

**The open-source NotebookLM (now Gemini Notebook) alternative with explainer videos.**

Understand what you have to read. Explain what you know.

Preparing for an exam · reading a stack of papers · getting a new colleague up to speed · turning a manual into something people will watch.

Add your PDFs, notes, slides and links. Open Sourcebook turns them into a short explainer video, drawn scene by scene, and into flashcards, a quiz, a guide, audio and answers. Every cite is checked word for word against your source.

Free and open source. It runs on your own computer, on the AI plan you already have (Claude, ChatGPT, Gemini, Cursor, GitHub Copilot and more) or on a model API key, and your files stay on your computer.

Website: [opensourcebook.app](https://opensourcebook.app)

<!-- DEMO CLIP PLACEHOLDER. A short clip recorded from the real app goes here: a file dropped in, a video being made and played, a cited answer opening its passage, a card flipped. Until it is recorded, nothing is shown in this place. -->

<!-- SCREENSHOTS PLACEHOLDER. Two or three pictures of the real app go here: a project with its sources and chat, a video playing, a quiz or a set of flashcards. Until they are taken, nothing is shown in this place. -->

## What you get

| | |
|---|---|
| **Explainer videos, drawn for your material** | Each scene is written and drawn, the agent looks at its own frames and fixes them, and a fresh viewer reviews the cut before you see it. With captions, and with narration, music and sound effects once you set a voice. |
| **Twelve styles, any length up to 30 minutes** | From Chalkboard and Blueprint to Comic, Neon, Documentary and Map and timeline, each picked by its picture. Ask for 30 seconds or a full walkthrough, or let the length fit the material. |
| **Your plan, or an API key** | Use the AI plan you already have, whether that is Claude, ChatGPT, Gemini, Cursor or GitHub Copilot: no API key is needed. A key works too: a Gemini, DeepSeek or OpenRouter key for chat, flashcards and quizzes, or any provider you connect in OpenCode for everything, videos included. |
| **Six agents, any model they offer** | Claude Code, Codex, OpenCode, Cursor, Antigravity and GitHub Copilot. Pick who makes each kind of thing, with which model and effort. |
| **A whole set from one request** | "Get me ready for Friday's exam" or "get a new teammate up to speed on this runbook" becomes a plan of videos, flashcards, quizzes, audio and guides in order. Look it over, change it, start it. |
| **Flashcards that come back** | Nine kinds of card, from fill the gap to label the picture. The ones you miss return in the same sitting and on later days until they stick. |
| **Quizzes that grade your working** | Choices, problems worked in steps, things to order, pairs to match, a line to draw on a graph. Three questions, or a timed practice exam. |
| **Answers you can check** | Every cite is checked word for word against your source, and opens the passage it came from. |
| **Audio, guides and a mind map** | A voice that walks you through your sources, notes to keep with a cite at every claim, and your sources' main ideas drawn as a map in the chat. |
| **Talk back to anything** | Ask about a moment of a video, a card or a quiz answer, or say "make it shorter". One scene of a video can be made again from a note. |
| **On your phone** | Scan a QR code and a phone on the same Wi-Fi opens your projects, with everything you made as a feed to scroll. |
| **Yours** | It runs on your own computer, your files stay there, and the code is open source under MIT. |

More on each, and on how to ask for one: [`docs/USING.md`](docs/USING.md). What has been run for real, and what is rough: [`docs/LIMITS.md`](docs/LIMITS.md).

## Install

On a Mac or Linux, paste this into a terminal:

```bash
curl -fsSL https://opensourcebook.app/install | sh
```

On Windows, paste this into PowerShell:

```powershell
irm https://opensourcebook.app/install.ps1 | iex
```

The line downloads Open Sourcebook into one folder, `.opensourcebook` in your home folder, never asks for your password, and opens it in your browser after a few minutes. Your projects and settings are kept apart from it, in the app data folder (`~/Library/Application Support/Open Sourcebook` on a Mac), the same one the desktop app and a clone use, so you never have them in two places. You need one agent of your own, installed and signed in the normal way: Claude Code with a Claude plan, Codex with a ChatGPT plan, Antigravity with a Google plan, Cursor, GitHub Copilot or OpenCode. No API key is needed, and one works too ([`docs/INSTALL.md`](docs/INSTALL.md#an-api-key-instead-of-a-plan)). A voice for videos and audio is separate: a key for a voice service, or a free voice that runs on your computer ([`docs/VOICE.md`](docs/VOICE.md)).

Open Sourcebook is made and used on a Mac, where the install has been tried from local files and not yet from the public address. The Linux and Windows lines are written and not proven yet. The details: [`docs/INSTALL.md`](docs/INSTALL.md).

## Your first video

1. Open Sourcebook opens in your browser on a short setup: connect the agent you have, then pick a voice or skip it for now.
2. Make a project and add a source: a PDF, your notes, slides or a link.
3. In the project's chat, ask in your own words: "Make a short video on how the Krebs cycle works, from chapter 7", "Explain this paper's method", or "A 2-minute video that walks a new teammate through this runbook". A sheet opens, already filled in.
4. Press its button. A video takes from a few minutes, depending on the model you pick, and you can keep using Open Sourcebook while it is made.

## Supported agents

| Agent | Runs on | Chat | Flashcards, quiz, audio and guide | Video |
|---|---|---|---|---|
| Claude Code | Your Claude plan | ✓ | ✓ | ✓ |
| Codex | Your ChatGPT plan | ✓ | ✓ | ✓ |
| OpenCode | Any provider you connect in it, or its own models | ✓ | ✓ | ✓ |
| Cursor | Your Cursor plan | ✓ | ✓ | ✓ |
| Antigravity | Your Google (Gemini) plan | ✓ | ✓ | ✓ |
| GitHub Copilot | Your Copilot plan | ✓ | ✓ | ✓ |

Used most with Claude Code and Codex. If an agent fails for you, open an issue and it gets fixed. What has been run for real with each, and on which system: [`docs/LIMITS.md`](docs/LIMITS.md).

## What leaves your computer

- Your files, your projects and everything made stay on your computer. Open Sourcebook has no server that receives them.
- Your agent sends what it reads from your sources to its own provider, as it does whenever you use it.
- Open Sourcebook fetches the links you add as sources, and the video agent may search the web and open pages while it makes a video.
- A hosted voice, if you add its key, is sent the narration's text. The voice that runs on your computer sends nothing.

The full list: [`docs/PRIVACY.md`](docs/PRIVACY.md).

## For agents

Open Sourcebook is an app on the person's own computer that turns their sources into videos, flashcards, quizzes, audio, guides and cited answers. Everything the app does is also an `opensourcebook` command, so you can drive it from your own session.

Install it with the one line above (`curl -fsSL https://opensourcebook.app/install | sh`). Then:

```bash
opensourcebook start --background                 # start it; `opensourcebook status` says whether it answers
opensourcebook project make "Onboarding"          # a project, used by the commands after it ("Cell biology", "Thesis reading")
opensourcebook source add runbook.pdf https://example.com/page
opensourcebook chat ask "What does this paper's method assume?"  # an answer with cites
opensourcebook make video "a 2-minute walk through the deploy runbook for a new teammate" --wait   # or flashcards, quiz, audio, guide
opensourcebook plan make "get me ready for Friday's exam"        # several things, as a plan to start
opensourcebook item get <item>                    # a video's file, or flashcards or a quiz as JSON
```

`opensourcebook help` lists every command and each takes `--json`. The skill that teaches an agent to use them is in [`skills/opensourcebook`](skills/opensourcebook), and `opensourcebook skill install` copies it to where your agent looks for skills. More: [`docs/COMMAND.md`](docs/COMMAND.md) and [`llms.txt`](llms.txt).

## How I built this

I am Mikiyas, and I make Open Sourcebook on my own. I used Fable 5.1, Fable 5.2 and Opus 5.5 in Claude Code, within T3 Code, to develop this project. How it got here is in [`docs/STORY.md`](docs/STORY.md).

## Contributing

Everyone is welcome, and pull requests are encouraged. Fix what is broken, add what you think is missing (a style, a piece, an agent, a voice, a fix for your system), or report a bug. How: [`CONTRIBUTING.md`](CONTRIBUTING.md).

## Docs

- Using it: [`docs/USING.md`](docs/USING.md), [`docs/INSTALL.md`](docs/INSTALL.md), [`docs/VOICE.md`](docs/VOICE.md), [`docs/PHONE.md`](docs/PHONE.md), [`docs/COMMAND.md`](docs/COMMAND.md).
- What is true today: [`docs/LIMITS.md`](docs/LIMITS.md), [`docs/PRIVACY.md`](docs/PRIVACY.md), [`SECURITY.md`](SECURITY.md), [`CHANGES.md`](CHANGES.md).
- Changing it: [`docs/DEVELOPING.md`](docs/DEVELOPING.md), [`docs/EXTENDING.md`](docs/EXTENDING.md), [`docs/STRUCTURE.md`](docs/STRUCTURE.md), [`AGENTS.md`](AGENTS.md), [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
- Where it is going and why: [`docs/PLAN.md`](docs/PLAN.md), [`docs/VISION.md`](docs/VISION.md), [`docs/DECISIONS.md`](docs/DECISIONS.md).

## Licence

MIT. See [`LICENSE`](LICENSE). Videos are drawn with [Remotion](https://www.remotion.dev), which has its own licence: free for an individual, a non-profit and a company of up to three employees, while a larger company needs its own Remotion licence. That and everything else Open Sourcebook ships or depends on: [`docs/THIRD-PARTY.md`](docs/THIRD-PARTY.md).
