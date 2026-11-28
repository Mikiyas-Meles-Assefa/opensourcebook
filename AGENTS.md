# Working in this repo

This is the guide for anyone changing Open Sourcebook, person or coding agent. People should read [`CONTRIBUTING.md`](CONTRIBUTING.md) too.

## What Open Sourcebook is

An open-source app that turns a person's own sources into things that help them understand and explain. A person adds PDFs, notes, slides and links, and the agent they already have (Claude Code on a Claude plan, Codex on a ChatGPT plan, or OpenCode, Antigravity, Cursor or GitHub Copilot) makes a short explainer video, drawn scene by scene, and flashcards, a quiz, a guide, audio and cited answers from them. Every cite is checked word for word against the source. It runs on their own computer as four programs: the engine (`engine/`), the web app (`web/`), the agent connector (`services/agent-connector/`) and the scenes service (`services/scenes/`), started together by the launcher (`cli/`; `npm start` in a clone, the `opensourcebook` command after the one-line install in `install/`). There is also an iPhone app (`ios/`). Study is the first thing it does, not the only thing it is for.

## Read first, in this order

1. [`docs/STRUCTURE.md`](docs/STRUCTURE.md): where things live and how to add one.
2. [`docs/VISION.md`](docs/VISION.md): what Open Sourcebook is for and the shape of the product.
3. [`docs/GLOSSARY.md`](docs/GLOSSARY.md): the words on screen and the names in code.
4. [`docs/DECISIONS.md`](docs/DECISIONS.md): what has been settled and why. Later rows win over earlier ones.
5. The README of the program you are changing.

## Run it and check it

```bash
npm start                  # all four programs, with whatever agent you have signed in
npm run check              # what this computer is missing
npm run status             # which programs of a running copy answer
npm run update             # the newest version, a fast-forward only (CHANGES.md says what is new)
npm start -- --no-open --ports-from 9100   # a private set of ports, no browser (the same projects)
npm start -- --data /tmp/osb --ports-from 9100   # a scratch copy: its own projects and settings in that folder
```

Checks, each from its own folder (more in `CONTRIBUTING.md`):

- root: `npm run typecheck`, `npm test`
- `engine/`: `npm run typecheck`, `npm test`
- `web/`: `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
- `services/agent-connector/`: `npm run typecheck`, `npm test`
- `services/scenes/`: `npm run typecheck`, `npm test` (headless Chrome first: `npm run browser`, once)

## Rules that hold

- **One concern per commit, and each commit passes its program's checks.** A message is one plain sentence with the area first: `Engine: ...`, `Web: ...`, `Scenes: ...`, `Connector: ...`, `Launcher: ...`, `Docs: ...`, `Skills: ...`, `Decisions: ...`. Add tests for what you add, and try it for real.
- **Build toward the vision.** Do not commit one way and flip it later. If the vision changes something, bring it already shaped the new way.
- **Add a row to `docs/DECISIONS.md` only for something lasting**, at the end, with the next free number. Do not refer to your own new row's number anywhere else; say what it says.
- **No secrets.** `.env`, `.dev.vars`, tokens, cookies and `.opensourcebook/` (and an older copy's `.re/`) stay out. Only `.example` files are committed.
- **No junk.** No `.DS_Store`, `node_modules`, build output, `xcuserdata` or generated videos.
- **Nothing hardcoded that the content, the person or a registry should decide.** New variety is one file or one folder in its home (`docs/STRUCTURE.md`): a style, a piece, a skill, a pack, an agent, an example, a maker or a kind. Code outside that home reads the list and never names a member. Open Sourcebook makes five shapes, video, flashcards, quiz, audio and guide; most new variety is a maker or a kind, and a new shape is the owner's call (`docs/STRUCTURE.md`, "Adding a shape").
- **For the agents Open Sourcebook runs: knowledge, tools and things they can see.** Skills to read, tools to call, pictures and reports of their own work. No rules, gates or critic passes forced on them, and no examples tied to one topic.
- **Examples illustrate, they are never the spec.** A sample from a person, a prototype or a skill shows the idea; extract the mechanism and do not hardcode the example.
- **No stand-ins.** What a person sees is made by a real maker or not at all. A fake used only by a test belongs under the tests.
- **Open Sourcebook never holds or forwards a subscription login.** It launches the person's own agent as it is installed and signed in (`docs/DECISIONS.md`, the row on the agent's login).
- **Plain words on screen:** video, flashcards, card, quiz, item, plan, source, project, maker, style, piece.
- **No tool lines in commits or files.** Using AI to work here is welcome, but a commit message, a doc and a code comment stay free of `Co-Authored-By` trailers, "generated with" lines and tool credits, because they stay in the history for good. A pull request's description may say AI was used; that is its author's choice.
- **Do not name another product as the source of an idea.** Say the thing in Open Sourcebook's own words. Naming something Open Sourcebook really depends on, such as Remotion or ElevenLabs, is fine. There are four exceptions, and only these: the README's headline names the well-known product Open Sourcebook is an alternative to; the README has one table that compares Open Sourcebook with three other notebook products by name, every cell about them checked against their own pages; the README's "How I built this" has one sentence in the owner's words naming the tools the project was developed with; and `CONTRIBUTING.md` names a few models as examples of the kind that do well here. Never in a commit message or a branch name.
- **Say what is true about where things run.** "On your own computer" and "your files stay on your computer" are true; the person's own agent still sends what it reads to its provider. Never write "100% local", "air-gapped", "offline" or "full-featured" about the product.
- **Ask when unsure of the intent.** State your understanding first.
