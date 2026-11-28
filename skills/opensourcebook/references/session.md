# A session with Open Sourcebook, step by step

More on each step of the session in `SKILL.md`, and what tends to go wrong. `opensourcebook <thing> <action> help` is always the exact word on a command: its arguments, its flags and its JSON.

## Starting Open Sourcebook

- `opensourcebook start --background` returns once every program answers, with the app's address. The launcher's own words go to `state/logs/launcher.log` in the app data folder (`~/Library/Application Support/Open Sourcebook` on a Mac, the same for the desktop app and every copy), which is where to look when it does not start. `opensourcebook stop` stops it and everything it started.
- `opensourcebook start` without `--background` runs in the foreground until Ctrl-C. That suits a person at a terminal; from an agent session it would never return.
- `opensourcebook start --ports-from <port>` uses ports from that one up, when the usual ones are taken.
- `opensourcebook status` says whether each of Open Sourcebook's programs answers. `opensourcebook agent list` says whether the coding agents Open Sourcebook runs inside (the ones that write answers and make things) are installed and signed in, and what to run when one is not. If no agent is ready, nothing can be answered or made: tell the person what `opensourcebook agent list` says.

## Projects and sources

- A project is a notebook: its sources, its chats, its plans and what was made. The command remembers the project used last, so after `opensourcebook project make` or `opensourcebook project use` you can leave out `--project`. When you work on more than one project, name it every time.
- Add every file the person means in one `opensourcebook source add` (it takes many). Open Sourcebook reads each while you wait: PDFs, documents, slides, text and Markdown files, web links, pictures and recordings. The answer has each source's id and status.
- Read the statuses. `ready` is read. `failed` comes with `errorMessage` saying why; `opensourcebook source retry <id>` tries again when that could help (a link that did not answer). `opensourcebook source show <id>` lists anything that could not be read, such as a page of a PDF that was a picture.
- Paragraph numbers in `opensourcebook source show`, `read` and `search` (P1, P2, ...) are for finding your way in the text here. Cites in answers and made things carry their own quotes; you never need to turn one into the other.

## Asking

- `opensourcebook chat ask` waits while the reply is written (usually well under a minute) and shows each step on stderr. It answers only from the project's sources; `--source <id>` narrows it to some of them.
- Each new `opensourcebook chat ask` without `--chat` starts a new chat. Use `--chat <id>` to follow up on an answer, so Open Sourcebook has the earlier turns.
- A reply that could not be written says so and carries `failed` with a reason (the agent is signed out, at its usage limit, or took too long); the words say what to do.

## Plans

- `opensourcebook make <shape> <words>` is for one thing: it starts at once and answers with the one-item plan it was made as, so `opensourcebook plan wait`, `opensourcebook item wait` and `opensourcebook item get` work on it as on any plan. A follow-up in the same chat (`--chat`) remakes it.
- `opensourcebook plan make` sends the person's request to Open Sourcebook's planner, which reads the sources and writes a plan in the chat. Say what the person said: how many things, how long, which shapes, what they are preparing for. The planner decides the rest from the sources; you do not need to design the items.
- The planner may answer with a question instead of a plan (what the person is studying for, how much time they have). Then `plans` is empty and `reply.questions` holds the question with its options: ask the person, then `opensourcebook chat pick <option id> --chat <chat id>`.
- A plan starts as a draft. `issues` on it lists anything that would stop it starting, in plain words (an item that reads no source, a shape that cannot be made here right now). Fix those with `opensourcebook item change`, or tell the person.
- A plan cannot be changed once it has started; `opensourcebook plan stop` stops it, and `opensourcebook plan start` on a stopped plan goes on from what is not made yet.

## Making and waiting

- `opensourcebook plan start --wait` and `opensourcebook plan wait` end when every item is made or failed, or when an item asks the person whether to go on (an "ask me" branch: `opensourcebook item answer <item> yes|no`). The answer lists every item with its state.
- `--timeout <minutes>` sets how long a wait follows (30 minutes by default). When it gives up, the making goes on inside Open Sourcebook; wait again later.
- A failed item says why in `errorMessage`. `opensourcebook item retry <item>` makes it again; that helps when the cause was passing (the agent was busy or timed out) or has been fixed. A usage limit on the person's agent plan is passing too, but only once it resets: say so, give them the retry command, and leave it there. `opensourcebook agent list` says whether an agent is installed and signed in; it cannot see how much of a plan's usage is left.
- `opensourcebook status` can show a program as not answering while it is busy making something; asking again a little later tells a slow program from a stopped one.
- Waiting is quiet work: a video can take ten minutes or more. Tell the person it is being made and that the app shows it live.

## Handing it over

- `opensourcebook project open` opens the project in the app; `opensourcebook item open <item>` opens one made thing. Both print the address too, which you can give the person when the browser is elsewhere.
- `opensourcebook item get <item>` saves a video's file (to `<item id>.mp4`, or `--to <file>`), or gives a set of flashcards or a quiz as JSON.
- `opensourcebook cards review <item>` gives the cards of a set due now (every card the first time, or with `--all`), each front with the back to check against. Put each front to the person, let them answer, show the back, then `opensourcebook cards mark <item> 1=got 2=not` keeps what they got, and the cards come back when they would in the app.
- `opensourcebook quiz show <item>` gives the questions without the answers. When the person answers, `opensourcebook quiz answer <item> 1=B 2=D 3=A` grades them as the app does and records the result on the item, so the plan's later items can use it. A worked question is answered step by step: `4.1=12 4.2=B`. Working to fill in is answered gap by gap the same way (`5.1=4 5.2=30`); things to put in order by the numbers `opensourcebook quiz show` gave them, in order (`6=3,1,2`); pairs to match and a picture's marks by a letter for each in turn (`7=B,A,C`); a line on a graph by two of its points (`8=1:15,3:25`).
- `opensourcebook project export` writes the whole project to one file; `opensourcebook project import <file>` reads one back in as a new project.
