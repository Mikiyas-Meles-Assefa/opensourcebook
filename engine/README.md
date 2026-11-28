# Open Sourcebook engine

Cloudflare Worker + Queues + D1 + R2 backend for Open Sourcebook. It turns sources
(links, PDFs, uploads, videos, pasted text) into items, each made in a
format, on its own or as part of a plan. It was rebuilt module by module
from the August engine (`docs/STORY.md`); this README describes the code as
it is now.

Words follow `docs/GLOSSARY.md`: plan, item, format, brief, chat, Start. Code
and table names keep their older ones (`plan_nodes`, `outputs`, `sessions`,
`kickOff`, `kicked_off_at`); an identifier is always written in backticks.

## Layout

```
src/
  index.ts          worker entry: routes and the queue handler
  wiring.ts         builds stores, services, registry, providers and runners from env
  http.ts           JSON responses, client-token auth, owner ids
  routes/           /v1/formats, /v1/projects + /v1/inbox, /v1/plans (edits, Start, progress, done ticks), /v1/outputs, /v1/sources, /v1/uploads + /v1/assets, the /v1/jobs wrapper
  net.ts            shared fetch, URL and hashing helpers
  types/            source, env, bindings, provider and media provider types
  cards/            the flashcards contract (contract.ts, docs/flashcards.md), the kinds of card (kinds.ts),
                    the block types and their schema, the card validator, and serving an old byte or page as cards (upgrade.ts)
  assets.ts         harvested media in R2, served at /v1/assets/<id>
  uploads.ts        client uploads in R2
  providers/        Gemini, DeepSeek, OpenRouter, OpenAlex; router; usage logging;
                    media plumbing (media.ts), a text-only reasoner, Commons picture search
  extract/          one module per content type, one ladder per source kind
  research.ts       OpenAlex enrichment and grounded research
  verify.ts         URL, media and chart checks
  sources/          add a source, extract once by content hash, chunk; an item's sources and passages
  engines/flashcards/ the flashcards format: Open Sourcebook's own writer (engine.ts), your agent's maker (agent-maker.ts), settings, cites, repair
  engines/quiz/     the quiz engine: question kinds, grading into a result
  engines/video/    the video format: its makers (the drawn scenes maker in scenes/), the checks every video gets
  engines/retry.ts  provider retries and the error engines throw
  dedupe-media.ts   one appearance per harvested asset across a set
  jobs/             generation_jobs store (compare-and-set), lifecycle, consumers
  video/            the video payload
  studio/           format registry, branch conditions, repositories, output runner, plan runner
  chat/             chats: the turn (service.ts), the sources a reply reads (context.ts, retrieval.ts),
                    cited answers (answer.ts), the skill registry and router, the planning skill (planning/)
migrations/         D1 schema, 0001 to 0012
docs/api.md         the Studio API contract
docs/flashcards.md the flashcards payload contract
docs/video.md       the video payload contract
tests/              vitest; tests/support holds the fakes (SQLite D1, R2, engines)
```

## Routes

Every `/v1` route except assets needs the `x-client-token` header (the August
shared token; there are no users yet). Rows are owned by a hash of the token,
never the token. Errors are `{ "error": "<code>", "message": "..." }`: 401
without a token, 403 for a wrong token or none configured, 503 when the database
(`RE_JOB_DB`) is not bound.

The Studio API (projects, the Inbox, plans and their items, outputs, usage,
chats and skills) is
specified in [`docs/api.md`](docs/api.md), the contract the web Studio and the
phone are built against. The table below lists the routes that came before it.

| Route | What it does |
|---|---|
| `GET /health` | `{ "ok": true }` |
| `GET /v1/assets/:id` | Harvested media. Public, content-addressed, cached for a year. |
| `GET /v1/formats` | Every format's descriptor, in registration order (video, flashcards, quiz, audio, guide): `200 { formats: [{ id, label, colorSlot, icon, aliases?, settings, defaults, ready }] }`. `ready` is true when an engine can make it now. Clients draw badges, icons and settings forms from this. |
| `GET /v1/edge-kinds` | The kinds of link between plan items the plan runner reads, in words: `200 { edgeKinds: [{ id, label, about }] }` (engine/docs/api.md, "Formats"). |
| `POST /v1/uploads` | Raw body, a supported `content-type` (with none, or `application/octet-stream`, the type the `x-upload-filename` ending says), optional `x-upload-filename`, at most 25 MB. `201 { upload: { id, contentType, filename?, byteLength, uploadedAt } }`; `415 unsupported_media_type` and `413 upload_too_large` start their message with the file's name. |
| `GET /v1/uploads/types` | What `POST /v1/uploads` takes: `200 { maxBytes, types: [{ contentType, extensions, group }] }`, from the one list it checks (`src/uploads.ts`). `image/*` stands for every type under `image/`. |
| `POST /v1/sources` | `{ url? \| text? \| uploadId?, projectId?, kind?, title? }`. Adds a source to a project the caller owns, or to the Inbox without `projectId`, and extracts it. A Google Drive, Docs, Slides or Sheets link shared with anyone who has the link is read as its file (docs/api.md, "Sources from a folder and from Google Drive"). `201 { source, extraction, chunkCount }`; `200` with the existing source when the same content is already in that place. |
| `GET /v1/sources/:id` | `{ source, extraction, chunkCount }`. A removed source that something still points at reads back with `source.removedAt`. Renaming, removing and trying a source again are in docs/api.md. |
| `GET /v1/plans/:id/progress` | The plan's items in order with `status`, `job?`, `outputId?`, `done`/`doneAt?`, the recorded `result?` and `asking?: { question? }` for an undecided "ask me" branch, plus `stages` and `counts: { total, done }`. Any status, even before Start. An item that has a job carries `job: { id, status, stage, progress, attempt, step?, startedAt?, errorMessage?, errorDetail?, validation? }` (on a failed job, `errorMessage` is the plain line and `errorDetail` the technical text; while it runs, `step` is what it is doing now in plain words when its engine says, such as a scenes video's "Writing scene 2 of 5", and `startedAt` when this attempt started); while it runs, the item's `status` follows its job (`running` as soon as the job is, not when it settles), and `validation` is what each validation of its output found (the output runner, below). A `failed` item also carries `errorMessage`, why in plain words (engine/docs/api.md, "Item"). |
| `POST /v1/plans/:id/items/:itemId/done` | `{ done? = true, result?, outputId? }`. Ticks or un-ticks an item and records its result (replaces the whole result). `200 { item, counts }`; `409 plan_not_started`, `409 item_not_ready` (no output yet), `400 output_mismatch`, `413 result_too_large`. Advances the plan. |
| `POST /v1/plans/:id/items/:itemId/progress` | `{ progress: object \| null }`. Keeps where the person stopped in the item (its shape belongs to the format: each card's box and due time for flashcards, a quiz's answers so far, a video's time; `null` clears it), so the phone and the web carry on from the same place. Leaves the tick and the result as they are and never moves a branch. `200 { item }` with `progress` on it, as on every plan read; `409 plan_not_started`, `409 item_not_ready`, `400 invalid_request`, `413 progress_too_large` (16,000 characters of JSON). |
| `POST /v1/plans/:id/items/:itemId/retry` | none. Makes a failed item of a running or failed plan again, or carries on a stopped one (also in a stopped plan); the plan runs again. `200` plan view; `409 plan_not_running`, `409 item_not_failed` (docs/api.md "Approve, Start, cancel"). |
| `POST /v1/plans/:id/items/:itemId/stop` | none. Stops one item being made (queued, running or waiting), keeping what its maker saved; the rest of the plan goes on, and what depends on it waits without failing the plan. `200` plan view; `404`, `409 item_not_running` (docs/api.md "Approve, Start, cancel"). |
| `POST /v1/plans/:id/items/:itemId/answer` | `{ answer: boolean }`. Answers an "ask me" branch while it is pending in a running plan; true runs it, false skips it. `200 { item, counts }`, or `409 not_asking`. |
| `POST /v1/jobs` | The August API, kept for the iOS app. Needs `Idempotency-Key`. Body `{ sourceText, sourceURL?, sourceKind?, requestedDepth?, uploadId?, projectId?, exemplarSummaries? }`. `202 { job }` |
| `GET /v1/jobs/:id` | `{ job }` |
| `POST /v1/jobs/:id/retry` | A failed retryable or dead job goes back to the queue. `202 { job }`, or `409 not_retryable` |
| `POST /v1/jobs/:id/cancel` | `{ job }`, or `409 already_done` |

### The `/v1/jobs` wrapper

A POST adds the source (into the project when the engine has it, otherwise the
Inbox; the phone's `projectId` stays on the job either way), creates a
generation job of kind `output`, format `flashcards`, and schedules it. A repeated
idempotency key returns the first job. A link shared as text is promoted to
`sourceURL` and the rest of the text is passed to extraction as a caption.

The `job` it returns is the August shape:

```
{ id, stage, status, progress, retryable, errorMessage?, errorDetail?, resultByteID?, result?, cards?,
  sourceText, sourceURL?, uploadId?, sourceKind, requestedDepth, projectId?,
  retryCount, createdAt, updatedAt }
```

- `stage` is always one of August's: `queued extracting researching structuring
  writing verifying done failed`. Engine stages are mapped (`starting` reads as
  extracting, `repairing` as verifying, anything new as writing).
- `status` is `queued`, `running`, `done` or `failed`. A cancelled job reads as
  failed with "Cancelled by user"; a dead job reads as failed and retryable. A
  retryable failure the queue will redeliver reads as running, so the phone
  keeps polling.
- On `done`, `cards` is the set of flashcards ([`docs/flashcards.md`](docs/flashcards.md))
  and `result` is the same set laid out as one version 1 page (each card's
  front, then its back), which is what the phone build that only knows pages
  decodes. `resultByteID` is the id they share; it keeps its old name for that
  build. A job finished before flashcards (format `read`) hands back its
  stored page as `result` and that page served as cards as `cards`.

## Sources

A source is one person's row in `sources`, in a project or the Inbox. What it
points at is identified by a content hash, namespaced by what was hashed:
`url:<sha256 of the normalized URL>`, `upload:<sha256 of the bytes>`,
`text:<sha256 of the trimmed text>`. The extraction (`source_extractions`) and
its chunks (`source_chunks`) hang off the hash and are shared by everyone with
the same content: the first caller to claim a hash extracts it, later adds
reuse it, and a second caller that arrives mid-extraction is told to come back
(a job retries). An extraction stuck for ten minutes may be taken over.

Chunks are paragraph-aligned passages with a `SourceLocator`: a character
range always, and the page too for a PDF (the PDF ladder keeps a page break
between pages and no chunk crosses one). An item's range
(`plan_node_sources`) can be a page span (`page`..`endPage`), a slide span,
a time span or a character range.

**Long sources** (`engine/docs/long-sources.md`). A source keeps up to
400,000 characters (`MAX_SOURCE_CHARS` in `extract/context.ts`), links,
uploads and pasted text alike, stored whole in D1 with all its chunks. Above
that the text is cut once (`capSourceText`), at a paragraph or sentence end,
and says so: a plain limitation ("Only the first 399,870 of 612,004
characters of this source are used (about 65%)…") and `metadata.textChars`,
`textUsedChars` and `textCut`. What keeps each model call small is what it
reads (`sources/reading.ts`), not cutting the source: an item with a range
reads exactly that range; a set of flashcards over a long source plans its sections from
a map of all of it and each section reads its own part (a spread of it when
the part is longer than a call reads); a quiz plans from passages spread
across everything it covers; the chat ranks every passage. Estimates price
what is read. Sources stored before this were cut at 24,000 characters;
they keep their text, chunks and limitation and are not read again.

**What could not be read.** An extraction says what it missed twice:
`limitations` in plain sentences a person reads ("Only this video's title
and channel name could be read, not what is said in it."), and
`extractionNotes` in technical words for logs (which tier, which fallback,
"rendered in a headless browser"). Each reader names its own gap where it
finds it, through `ReadingGaps` in `extract/limits.ts`: `add(plain, note)`
for a gap the person should know about, `note(note)` for one only the logs
need. Plain lines use the words source, page, video and file, name no
service or model, and carry no semicolon (a failed source's message is its
first limitation). Extractions stored before Nov 13, 2026 have no
`extractionNotes`; `withPlainLimitations` (`extract/stored-limitations.ts`)
reads their old lines through a frozen table, giving each its plain line
and keeping it whole in the notes.

**Page furniture.** Reader mode drops what surrounds a page's text before
Readability picks the article (`extract/furniture.ts`): `<nav>` and
navigation, note, table-of-contents and DPUB endnote roles; footnote marks
(a bracketed `<sup>`, or one holding a short same-page link); lists whose
items link back up to the text; heading edit links; and back-matter sections
("See also", "References", "External links", "Further reading" and their
French, Spanish, Portuguese, Italian and German names, one list in
`BACK_MATTER_HEADINGS`) when every later section of that level in the
article is back matter too. A bare "Notes" heading is not back matter, since
a recipe's notes are content; it goes only when its footnote list leaves it
empty. MediaWiki-generated pages mark the same furniture with classes
(`navbox`, `reflist`, `mw-editsection`, …), which are dropped as well.

## Jobs

A generation job (`generation_jobs`, migration 0003) is one unit of queued
work. `kind` picks the runner; `output` is the only kind today. Every write is
one `UPDATE ... WHERE id = ? AND version = ?`, so a writer that read a stale
row decides again instead of overwriting (this is what keeps a cancel from
being undone).

```
queued ──claim──▶ running ──complete──▶ done
  ▲                 │  ├──fail(retryable)──▶ failed ──redelivery claims──▶ running
  │                 │  └──fail(final)──────▶ failed
  └──retry── failed (retryable) / dead
cancel: queued / running / failed ──▶ cancelled
dead letter: queued / stale running / failed retryable ──▶ dead
```

- The consumer runs two jobs at a time per batch. A running job writes a
  heartbeat; one silent for two minutes is presumed dead and a redelivery takes
  it over. A run that loses the job (cancelled, dead, taken over) has its abort
  signal fired and every further write refused.
- A retryable failure is written as `failed` and the message retried with
  backoff (15 s doubling, at most 5 min); the redelivery resumes from the
  job's saved `state` (for an output job, the engine blueprint). A
  `JobFailure(message, false)`, a refused model account (402, 401, 403) or an
  error marked `retryable: false` fails for good.
- After `max_retries` (3) the queue sends the message to the dead-letter queue,
  whose consumer marks the job `dead`.
- When a job will not run again, the consumer calls `onFinished`; it calls it
  again on any duplicate delivery of a settled job. The plan runner listens
  there.

### The output runner

`studio/output-runner.ts` runs one engine for one job: it loads the job's
sources (extracting any that are not yet), builds the `EngineContext` (a
provider whose calls are logged to `usage` under the job, the asset store, the
run's abort signal, progress), calls `runEngine` with the blueprint saved on
the job, and writes the `outputs` row with the brief, settings and sources
used and the job's summed cost. An output still invalid after its last repair
round fails the job for good with the report summarized. Every validation
is kept on the job (`state.validation`, the last 12): the attempt, the round
(0 is the first output), whether it passed, error and warning counts, a count
per error code and the first 20 errors with their paths. That is what repair
rates are measured from. Brief, settings,
assumed outputs and fix inputs come from the job's input; the runner knows
nothing about plans.

Cost and budgets: `providers/prices.ts` is the one place prices live; add or
update a model there (a list of entries with `effectiveFrom` handles a dated
change). `wiring.ts` passes it to every adapter. A model with no entry writes
`usage.usd` as NULL and shows up as `unpricedCalls` in `usage.totals` and in
the job's `state`; it is never recorded as $0. A call the engine stopped
waiting for is written with `error = 'timeout'` and no cost (its tokens are
unknown, though the provider may bill it) and counted in `timedOutCalls`, in
the totals and in the job's `state`: a total with timed-out calls may be
undercounted. Flashcards and quiz cost estimates
are priced for the model that writes their text (`writingModel` in
`wiring.ts`); with no price for it an estimate has no `usd` and is marked
`unpriced`. The runner wraps the job's usage
sink and provider in `providers/budget.ts`: when recorded spend reaches the
job's `budgetUSD` the next provider call throws and the job fails with
"Budget exceeded" (not retryable; a retry counts earlier spend). A plan's
`budget_usd` (migration 0006) is checked at Start against the items' estimates
and caps each job at what the plan has left.

Media providers for video (`types/media.ts`): `Reasoner`, `ImageGenerator`
(generate, edit with style references), `Segmenter` (phrase to masks),
`SpeechSynthesizer` (audio with word timings) and `PictureSearch` (licence and
credit kept). Every adapter goes through `meteredCall` in `providers/media.ts`:
it refuses a call whose known price is above what the job has left
(`mediaContextFrom` reads that from the job's `BudgetGuard`), stops on the
job's abort signal, logs one usage event per upstream request and stores what
it made through `storeMedia` as assets. Built adapters: `StructuredReasoner`
(text only, over the router) and `CommonsPictureSearch` (free). Image, voice
and segmentation vendors are not chosen yet, so those interfaces have only
the scripted fakes in `tests/support/fake-media.ts`.

## The engine contract

Each format with an engine has an `OutputEngine` (`studio/types.ts`):

```ts
plan(ctx) → Blueprint                      // saved on the job; a redelivery skips it
generate(ctx, blueprint) → EngineOutput    // { title, summary, payload, citations, assets? }
validate(ctx, output, blueprint) → ValidationReport
repair(ctx, output, report, blueprint) → EngineOutput
produce?(ctx, output, blueprint) → EngineOutput   // optional: a video's file
```

`runEngine` (`studio/registry.ts`) is the only loop: plan (unless a blueprint
was saved), generate, validate, then repair and validate again up to the format's
`maxRepairRounds`, stopping between steps when the job is cancelled. An
engine with a `produce` step gets it once, after the output validates; an
output that never validates is never produced, and a redelivery that finds a
produced draft writes it without checking or paying again. Engines
keep no state between steps and do not return cost: every provider call
reports to `ctx.services.usage`.

A retry never pays twice for finished work. `ctx.services.checkpoint` keeps
pieces of one job's work on the job (`state.checkpoints`, written as each
piece finishes): `runEngine` keeps the newest whole output and the repair
rounds behind it (`draft`), so a retry after a failed repair goes straight
to validating that draft; the flashcards engine keeps each written section
(`section:<id>`) and the quiz engine each written question
(`question:<n>`), so a retry after a failure part way through writing
writes only what is missing. Checkpoints belong to the saved blueprint, are
read once at the start of an attempt, and are cleared once the output row is
written.

`EngineContext` carries the item (`node`: format, title, brief, parsed settings), its
sources with chunks and optional range, `assumes` (earlier outputs it may rely
on, never from its own level), `inputs` (an earlier item's output and the
person's result on it, from every edge that is not `assumes`), the project,
and the services.

### The flashcards format

`engines/flashcards/` makes a set of flashcards: an ordered list of cards,
each one phone screen, to swipe and flip and bring back until they stick
([`docs/flashcards.md`](docs/flashcards.md) is the contract). It was the byte
format until Nov 18, 2026; the old ids `byte`, `bits`, `read` and `cards` are
its aliases. Its settings are `cards` (how many; 0 fits the count to the
sources), `kinds` (which kinds of card it may use), the maker and hidden style
examples.

**The contract** (`src/cards/`). A card has a stable id, a `kind`, a front and
an optional back (each 1 to 6 blocks, at most one main block a side, at most
900 units a side), and its cites. How a card is marked is read from its
sides (`markOf`), not from its kind: a front that asks is marked by the
answer, a card with a back or a gap to fill is turned over and marked got it
or not yet, any other card is read. The person's progress is kept per card id,
so a maker that changes a card keeps its id. `validate.ts` checks the schema,
the sides, the cite shape, evidence-only URLs and media, that every cite names
one of the item's sources and every quote is in its passage word for word, and
that no text a person reads names a prompt label or calls the material "the
passage(s)" (`names_prompt_label`).

**Kinds** (`src/cards/kinds.ts`). Each kind is one entry: its words for a
person, an example, how it is marked and what it needs of a card's sides. The
makers' tools, the settings form and the planner all read that list; the
player draws a card from its sides and never names a kind. A new kind is one
more entry.

**Two makers**, as with the other formats (see "Flashcards and quizzes by your
agent"):

- **Your agent** (`agent-maker.ts`) works through Open Sourcebook's tools: `plan_cards`,
  `write_card`, `change_card`, `remove_card`, `read_cards` and `finish_cards`.
  Every check above is a tool's answer, so a card that fails is refused with
  what is wrong and nothing is kept until it is right.
- **Open Sourcebook's own writer** (`engine.ts`, `ApiFlashcardsEngine`, on a model API key):
  - *Plan*: read the sources, research when it helps, and plan sections for
    the number of cards in `cards` (or what the sources hold when it is 0).
  - *Generate*: each section is written as cards, several sections at a
    time. The prompts send the item's sources once, as passages labelled P1,
    P2, ... (`sources/passages.ts`), and a card cites them as `{ passage,
    quote?, block? }`; the engine turns that into the source, chunk and
    locator. It also cites what it can from the blocks alone: a harvested
    picture by its asset and page, a clip by its moment in the recording. A
    section that keeps failing becomes one short card that says so.
  - *Repair*, card by card: errors are grouped by the card they are in (a URL
    that failed verification belongs to every card that uses it), and each
    failing card goes to the model on its own, with its errors, the passages
    it cites and a line of the cards on either side. Its answer takes its
    place, keeps its id, and every other card is kept as it was. Several cards
    are repaired at a time, so a long set costs more calls, not a longer one.
    A card whose repair call fails stays as it was and the next validation
    reports it again. Errors on the set's own fields (title, subtitle) are
    filled from the plan with no model. Then, if the only errors left are
    media that cannot be verified, exactly those blocks are dropped (and a
    card left empty with them).
- **No text read**: when no source gave text to make cards from (a video with
  no transcript, a blocked page), the job fails at once with `NO_SOURCE_TEXT`
  and is not retried. Nothing is made from a title.
- **Old outputs**: a row stored as a byte (schema version 2), or as `read` or
  `bits` (version 1, one page of blocks), is served as a set of cards at read
  time by the definition's `upgrade` (`cards/upgrade.ts`); the row is never
  rewritten. The person's old progress (`{ bit }`) is read as where they
  stopped.

### The quiz format

`engines/quiz/` makes a quiz: questions with feedback, any length.
Stored rows and plan items with the old id `check` resolve to it. Its
purpose (a first look, a quiz after a topic, a long exam-style run, a fix
for what was missed) is written in the brief; the settings the descriptor
declares are length (0 lets the brief decide), question kinds, difficulty,
pass mark and when feedback shows.

- **Payload** (`schema.ts`, version 1): `title`, `passMark` (0 to 1),
  `feedback`, and `questions`, each with `id`, `kind`, `topic`, `prompt`,
  optional `display` (LaTeX), `points`, `feedback.correct` /
  `feedback.incorrect` and `cites` (passage id, source, chunk id when the
  source has stored chunks, character-range locator, and a quote). A kind
  adds its own fields: `choice` has `options` and `answer`; `worked` has
  `steps`, each typed values or a pick between options. Kinds live in a
  `QuestionKindRegistry` (`kinds.ts`); a new kind is one entry there, with
  its own `label` and one-line `description`, and the descriptor's
  "Question kinds" setting (a `choices` field) offers it from there.
- **Option order**: writers put the right option first far more often than
  chance (24 of 24 in the first real run), so the engine shuffles every
  question's options as it takes them in, through the kind's `arrange`. The
  answer index and `optionFeedback` move with their options. The shuffle is
  seeded by the job, the position and the prompt, and the stored payload is
  what players show, so a stored quiz never changes order. Players read
  `answer` as an index and assume no position.
- **Result** (`item_results.result_json`): `gradeQuiz` in `result.ts` turns
  the person's responses into `{ format, version, score, earned, total,
  correct, answered, count, passMark, passed, questions[], missed[],
  topicsMissed[], topics[] }`. `{ "kind": "metric", "metric": "score",
  "below": 0.7 }` branches on it, and a later item gets it as an input; the
  quiz planner reads an earlier quiz's topics missed.
- **Validation**: in code, the schema, each kind's rules (a `choice` whose
  right option is much longer than every wrong one, 1.4 times and 20
  characters past the longest, is an error, `answer_stands_out`), that every cited
  passage is one of the item's and its quote is in it word for word, and no
  two questions ask the same thing, and no text a person reads names a
  prompt label or "the passage(s)" (`names_prompt_label`); then a review call checks each question
  against its passages (answerable, marked answer right, no other option
  right, nothing the passages do not say). Repair rewrites only the
  questions with errors. Citations are by chunk and character range, as
  precise as extraction gives today; page and timestamp locators come with
  M3.

### The video format

`engines/video/` makes a video: a list of scenes, each with what is seen,
what is said word for word, text on screen, its length and cites, plus the
file ([`docs/video.md`](docs/video.md) is the contract; DECISIONS #48,
#54). Settings: `minutes` (0 lets the brief decide), `aspect` (`portrait`,
`landscape`, `square`), and the `maker` and `style` built from the makers.

The format's engine is a dispatcher over a registry of **makers**
(`engines/video/makers.ts`): each brings its own engine, words, styles and
estimate, and the format's `maker` and `style` settings are built from them
(`auto`, the open pick, by default; see `docs/api.md`, "Video makers"). The pick is
saved with the job's blueprint (`{ maker, made }`), so a retry makes the
same thing, and the repair rounds are the picked maker's. Every video,
whoever made it, is checked in code before it is kept
(`engines/video/checks.ts`: lengths, narration that fits its scene at 3.5
words a second, quotes word for word in their passages, no passage labels
on screen or in the voice).

The maker today is **drawn scenes** (`engines/video/scenes/`): it hands the
item to the scenes service on the person's computer, where their own agent
writes, draws, voices and renders the video. It is set up only with
`SCENES_SERVICE_URL` (this machine only) and `SCENES_SERVICE_TOKEN`, so it
is local only. With no maker set up, video stays declared and `GET
/v1/formats` serves it `ready: false`; nothing else makes a video.
`VIDEO_MAKER_DEFAULT` names the maker `auto` picks; unset, the first
set up. A new maker is one more entry in that registry; nothing outside a
maker's own module names it.

**No stand-ins (Nov 18, 2026; DECISIONS #69).** The storyboard maker (Open Sourcebook's
model writing the scenes, the render service (now gone) drawing each as a white frame
with its plan written on it), the mock engines (`RE_ENGINE_MODE=mock`) and
the offline provider (`GENERATION_PROVIDER=offline`) are gone, and nothing
in `src` can stand in for a maker. Videos the storyboard maker made still
open and play (`render.storyboard: true`); an item whose `maker` is still
`storyboard` reads as `auto`, and a job one of them planned (its
blueprint names the storyboard maker, was saved before makers existed, or
its `state.mode` was set by a mock engine) is planned again by the maker
it resolves to now.

### When a model account is refused

A 402 (out of credit) or 401/403 (key refused) from a provider is final: an
engine step does not retry it, the router does not wait it out, and the
consumer fails the job not retryable, so the queue does not redeliver it.
The job's stored message and the chat reply say it plainly, naming only the
provider ("The DeepSeek account is out of credit, so no model could be
called. Add credit or set another provider, then try again."); a failed
item says it about the item ("The model account is out of credit, so this
set was not made. Add credit, then try again.", `docs/api.md`, "Item"), and the
chat reply carries `failed: { reason: "outOfCredit" }` (or `"keyRefused"`)
so a client need not read the words (`docs/api.md`, "Message").

### Adding a format

Formats are open (docs/DECISIONS.md #24): a format id is any camelCase string
a registry declares, and nothing else in the engine lists them.

1. Write the engine under `src/engines/<format>/` implementing `OutputEngine`,
   and a `FormatDefinition`: a `FormatDescriptor` (id, label, colour slot,
   icon, older `aliases`, settings fields, defaults; every option of a
   `choice` or `choices` field has a `label` and a one-line `description`,
   which the registry checks), `maxRepairRounds`,
   `parseSettings` (raw `settings_json` to typed settings; it must accept the
   descriptor's defaults), `estimateCost`, and optionally `upgrade` (serves a
   payload stored at an older schema version in the current shape).
2. In `studio/default-registry.ts`, `register` it; if it was declared in
   `DECLARED_FORMATS` (shown to clients, no engine yet), move it out of there.
3. Test it through `runEngine` with a scripted provider, as
   `tests/cards-engine.test.ts` does.

Nothing else changes: routes, the output runner and the plan runner look
formats up in the registry, and `GET /v1/formats` serves every descriptor.
Routes serve every output through `FormatRegistry.served`: a row stored under
an alias comes back under the format's id, upgraded when the format has an
`upgrade`. A stored row whose id no registry knows is read back as it is.

## Plans

`studio/plan-runner.ts` walks a plan once it is started. Plans are created,
edited, approved, started and cancelled over the Studio API (`docs/api.md`);
the `/v1/plans` routes above read progress and record ticks, results and
answers. The routes check edits with the runner's `structuralIssues` and
approval with its `startIssues`, the same checks `kickOff` runs.

- Start (`kickOff`) needs an `approved` plan, checks that every parent and edge source
  sits on a lower level, that every condition is one a resolver reads and that an engine
  makes every enabled item's format (aliases resolve; a declared-only or
  unknown format refuses the Start, an unchecked item may name any), sets the plan
  `running` and `kicked_off_at`, and skips unchecked items.
- Levels (stages) run in order; all ready items of a level are queued at once, one job
  each, under an idempotency key derived from the item, so advancing twice
  queues nothing twice.
- An item assumes the outputs of the finished, enabled items on lower levels and
  of its `assumes` edges. Edge kinds are open: every other edge (`fix_of`, or
  any kind) becomes an input with the earlier item's output and, once the
  person has recorded it, its result from `item_results`.
- An item runs only if its parent and edge sources are `done`; otherwise it is
  `skipped`. Items that do not depend on a failure carry on. A plan that ran to
  the end with a failed item is `failed`, otherwise `done`. `cancel` cancels the
  plan's queued and running jobs.
- A branch item has a `condition_json`, a tagged object decided by a
  `ConditionResolver` in a `ConditionRegistry` (`studio/conditions.ts`):
  `{ "kind": "metric", "metric": "score", "below": 0.7 }` (or `"atLeast"`)
  reads a number on the parent's result; `{ "kind": "ask", "question"? }` waits
  for the person's `{ "answer": true | false }` on the branch item's own
  result. The shape written before kinds, `{ "metric", "below" }`, reads as
  `metric`. A new kind is a resolver registered on the registry. While the
  result a condition needs is not recorded, the item stays `pending` and the
  plan reports it in `waitingOnResult`; whatever records a result calls
  `advance` again.
- `item_results` (one row per item) holds the done tick (`done_at`) and the
  person's result; `plan_stages` holds optional stage labels. Both are read
  and written through `repos.results` and `repos.plans.setStageLabel`.

## Chats

A chat turn (`chat/service.ts`) stores the person's message, decides whether
to answer or use a skill, writes the reply and stores it; `sessions.busy_since`
(migration 0007) keeps two turns in one chat from interleaving. The contract
is `docs/api.md`, "Chats".

- **Replies are pieces** (`chat/pieces.ts`): text with cites, a plan, a
  question with options, in order. Kinds sit in a `PieceRegistry` that says
  how each reads as words, for the reply's plain `text` and for the history
  prompts show. A message that picks options (`answer`) is checked against
  the reply it answers; an option that names a skill hands the turn to it.
  A source the message @-mentions is added to the chat's ticked sources.

- **Answers** read the passages of the mentioned sources, else the ticked
  ones, else the whole project (`chat/context.ts`). When they do not fit the
  budget, the best matches are picked with BM25 over words cut by
  `Intl.Segmenter`, so no language is assumed (`chat/retrieval.ts`). The model
  cites passage labels; the engine turns them into the flashcards contract's `Cite`
  and checks each quote word for word, asking once more for a wrong one and
  then dropping it (`chat/answer.ts`).
- **What the chat knows about Open Sourcebook** is one place, `chat/about-opensourcebook.ts`: a short
  product description kept there, every format the registry declares with
  whether it can be made now, and the registered skills. The talk skill and
  the planner read it from there; no prompt names a format or a skill.
- **Talk** (`chat/talk.ts`) is the skill for messages about Open Sourcebook itself or the
  conversation: answered from that knowledge and the chat, with no cites.
  Only a question about the sources goes to the cited answer, which is the
  only reply that may say the sources do not cover something.
- **Skills** are `ChatSkill`s in a `SkillRegistry` (`chat/skills.ts`,
  registered in `chat/default-skills.ts`). Each says what it does, when to use
  it and its `/command`; the router (`chat/router.ts`) picks one per turn from
  those words, a command forces one. A skill with `offerWhen` may be offered
  at the end of a plain answer, as a question whose accepting option names
  it. The chat core names no skill.
- **Planning** (`chat/planning/`) is the first skill. Its prompt describes the
  plan model in general terms and lists, from the registries at run time, the
  ready formats with their settings, defaults and the numbers their results
  report (`FormatDescriptor.about`, `reports`) and the condition kinds
  (`ConditionResolver.about`, `example`). Sources are shown as S1, S2 with
  numbered passages; a run of passages becomes a range from the passages' own
  locators. The plan is checked like a plan edit (`checkDraft`), priced with
  each format's `estimateCost`, sent back with its problems for up to two more
  rounds, and written only when clean. Unless `/plan` forced it, the planner
  may ask first instead (`ASK_SHAPE`): its questions become question pieces
  whose options come back to planning. A later message changes the chat's plan
  with ops on named items; they are applied to the plan as re-read after the
  model answers, and an item whose `updatedAt` moved meanwhile is left as the
  person has it. Items the person made or changed by hand since the chat last
  wrote the plan are marked for the model, and an op on one holds only when
  the message names it (by @-mention or by its title). A remark or question about the plan gets an answer with no
  change and no card. The planner is told the declared-but-not-ready formats
  too, so it can say plainly that it can't make one instead of passing another
  format off as it, and each brief opens with a line a person reads.
- Every call is logged in `usage` with the chat (`session_id`) and project,
  through a `BudgetGuard` when the turn sends `budgetUsd`.
- **Your agent** (`chat/agent/`, DECISIONS #53; local only): with
  `CHAT_AGENT_URL` and `CHAT_AGENT_TOKEN` set, `ChatService` hands every turn
  to `AgentChat` instead of answering it, and needs no model provider. The
  reply is stored running; the connector on the person's computer
  (`services/agent-connector`) runs their own Claude Code with only Open Sourcebook's
  tools. Each tool call comes back to `POST /v1/agent-turns/:id/tools` with
  the turn's token, is recorded as a step in `agent_steps` (migration 0010)
  and run by its handler in `chat/agent/default-tools.ts`, the one registry
  of tools. Tools reuse the chat's own code: ranked passages
  (`rankPassages`), the strict cite check (`readAnswer`), and the planner's
  read, price, check and write (`chat/planning/commit.ts`). When the agent
  ends, `turn.ts` assembles the steps' results into pieces, releases the
  chat and logs one `usage` row as `agent:<id>` at no cost. Stop, time-outs
  and the connector's failures end the reply in plain words.

## Migrations

| File | What |
|---|---|
| `0001_create_jobs.sql` | August's `jobs` table (whole job as JSON). Already applied in production; no code reads it now. |
| `0002_create_assets.sql` | August's `assets` table. Applied; still never written (asset bytes and metadata live in R2). |
| `0003_generation_jobs.sql` | `generation_jobs`: plain columns, compare-and-set `version`, any format. |
| `0004_studio.sql` | Projects, source extractions and chunks, sources, `sessions` and `messages` (chats), `plans` with `plan_nodes` (items), their sources and edges, `outputs`, `usage`. |
| `0005_plan_stages_item_results.sql` | Additive: `plan_stages` (optional stage labels) and `item_results` (done tick and the person's result per item). |
| `0006_plan_budget.sql` | Additive: `plans.budget_usd`, an optional spending cap for a whole plan. |
| `0007_chat_turns.sql` | Additive: `sessions.busy_since`, set while a reply is written so two turns in one chat cannot interleave; an index on `plans (session_id, created_at)` for the plans a chat made. |
| `0008_usage_error.sql` | Additive: `usage.error`, why a failed provider call failed; `timeout` marks a call whose cost is unknown, so totals can say they may be undercounted. |
| `0010_agent_turns.sql` | Additive: `agent_turns` (a chat turn the person's own agent answers: its reply message, the hash of its token, its state) and `agent_steps` (each tool call, in order, with what it added to the reply). |

The comments inside `0004_studio.sql` use the words from before the glossary
(album, node, Studio type, kick off, session, single, category). The file is
left as applied; read them as plan, item, format, Start, chat, an item made on
its own, and topic.

The move to `byte`, `quiz` and `video` (Nov 12, 2026), and the byte becoming
`flashcards` (Nov 18, 2026), need no migration. Rows stored with `read`,
`bits`, `byte` or `check` keep those ids and their payloads; they are served
under the new ids, and a version 1 page or a byte as a set of cards, at read
time (see "The flashcards format"). That keeps the live database untouched, works
for rows written by a phone or a job still in flight during the deploy, and
can be undone by deploying the earlier Worker.

Value sets that grow (statuses, kinds, format ids, origins) are checked in code,
not in CHECK constraints. Apply with
`npx wrangler d1 migrations apply re-mvp-engine-jobs --remote --config wrangler.local.toml`
(your own copy of `wrangler.toml` with your worker name and database id; the
committed file carries placeholders).

## Queues

`RE_BYTE_QUEUE` sends to `re-byte-jobs` (batch 5, 5 s, 3 retries). Both are old names, from before the product was called Open Sourcebook and from when the shape was the byte; they are the deployed queue's names and stay. Its
dead-letter queue must exist before the first deploy with this config:

```bash
npx wrangler queues create re-byte-jobs-dlq
```

The worker consumes both; `OPENSOURCEBOOK_JOB_DEAD_LETTER_QUEUE` names the dead-letter
queue so the handler can tell them apart. Without a queue binding (local dev),
a job runs in the background of the request that scheduled it and a retryable
failure waits for a manual retry.

## Environment

Names only; values go in `.dev.vars` locally (copy `.dev.vars.example`) and
`npx wrangler secret put <NAME>` in production. Never commit values.

- Secrets: `OPENSOURCEBOOK_CLIENT_TOKEN` (required); optional model keys
  `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENROUTER_API_KEY` (the second way
  to make flashcards and quizzes and answer the chat, after the person's own
  agent), `YTDLP_SIDECAR_URL`, `YTDLP_SIDECAR_TOKEN`, `JINA_API_KEY`.
- `SCENES_SERVICE_URL` and `SCENES_SERVICE_TOKEN`: the scenes service on this
  computer (`services/scenes`), which sets up the drawn scenes maker (see
  "The video format"); local only, a URL that is not this machine is
  refused. `VIDEO_MAKER_DEFAULT`: the maker `auto` picks (`scenes`);
  unset or not set up, the first one set up. Without a video maker, video
  is not ready.
- `CHAT_AGENT_URL` and `CHAT_AGENT_TOKEN`: the connector that runs the
  person's own agent for the chat (see "Chats", and
  `services/agent-connector`); local only, a URL that is not this machine is
  refused. Optional `CHAT_AGENT` (`claude`), `CHAT_AGENT_MODEL`,
  `CHAT_AGENT_EFFORT`, `CHAT_AGENT_CALLBACK_URL` (where the connector calls
  back; the request's origin when unset) and `CHAT_AGENT_TIMEOUT_MS`
  (default 600000, ten minutes; at most 1800000). With them set, the same agent also makes flashcards and
  quizzes (see "Flashcards and quizzes by your agent"); `ITEM_AGENT_MODEL` and
  `ITEM_AGENT_EFFORT` pick its model and effort for that, and
  `ITEM_MAKER_DEFAULT` (`agent` or `api`) the maker `auto` prefers.
- Vars: `GENERATION_PROVIDER` (`router`, `gemini` or `deepseek`),
  `GEMINI_MODEL`, `DEEPSEEK_MODEL`, `OPENROUTER_MODEL`, `OPENALEX_MAILTO`,
  `OPENSOURCEBOOK_JOB_DEAD_LETTER_QUEUE`, `OPENSOURCEBOOK_JOB_HEAVY_QUEUE`; optional `GEMINI_BASE_URL`, `DEEPSEEK_BASE_URL`,
  `OPENROUTER_BASE_URL`, `OPENALEX_BASE_URL`. `ASSET_PUBLIC_BASE_URL` is
  declared in `types/env.ts` but nothing reads it yet; the iOS app resolves
  `/v1/assets/<id>` against its own engine URL.
- Bindings: `RE_JOB_DB` (D1), `RE_ASSETS` (R2), `RE_BYTE_QUEUE` and
  `RE_HEAVY_QUEUE` (Queues). These four keep
  their names from before the rename, because a deployer's own
  `wrangler.local.toml` repeats them. `BROWSER` (Browser Rendering) is
  optional and only for a deployed engine: add `[browser]` with
  `binding = "BROWSER"` to `wrangler.local.toml` and a page that comes back
  empty or blocked is rendered in a headless browser. On a person's computer
  the launcher leaves it out even when the config names it, because the
  local runtime would download a whole Chrome to answer it and the engine
  would wait on that download; pages are read with plain requests there.
- **Names from before the rename.** Every setting was once `RE_X` and is now
  `OPENSOURCEBOOK_X`. The worker reads an old name that is set as the new one
  when the new one is not (`src/old-names.ts`), so an older `.dev.vars`, a
  deployed secret named `RE_CLIENT_TOKEN` and the four bindings above keep
  working. The code reads only the new names.

The yt-dlp sidecar (`services/ytdlp-sidecar`) is a separate Worker with its
own README. The render service that made the storyboard maker's files is gone
(DECISIONS #71).

## Flashcards and quizzes by your agent

Flashcards and a quiz each have makers, in the same shape as the video makers
(`src/engines/makers.ts`): **your agent** (`src/engines/flashcards/agent-maker.ts`,
`src/engines/quiz/agent-maker.ts`), registered when the connector is set, and
**the model API key** (the flashcards and quiz engines), registered when a key is
set. `auto` picks your agent when it is connected and answering, else
the key; with neither, the plan says before Start what is missing, and a job
fails with that said. An item may pick its maker in its `maker` setting.

Your agent makes an item in one turn through the connector, with Open Sourcebook's tools
for that item (`src/chat/agent/work.ts`, `work-tools.ts`): it reads the
sources (outline, search, read by label) and writes the flashcards card by card or
the quiz question by question. Every check the shape has is the writing
tool's answer: a quote not word for word in its passage, a card that does not
fit a screen, a block or a question kind the item does not take, are refused
with what is wrong, and nothing is kept until it is right. The kinds of block
come from `src/cards/shapes.ts` and the kinds of question from
`src/engines/quiz/kinds.ts`, so the tools describe whatever is registered.
What makes good flashcards or a good quiz is a skill the agent reads
(`skills/notebook/`, bundled as text by wrangler's rule for `.md`). Each
piece is kept on the job as it is written, so a retry carries on from it;
Stop stops the agent's turn; a connector that stops answering or a turn it
drops is said as such. The connector calls back on `POST
/v1/work-turns/:id/(tools|finish)` with the turn's own token.

## Running it

To run all of Open Sourcebook at once, run `npm start` at the repo root (`docs/DEVELOPING.md`): it starts this engine with the others, with the shared secrets and ports filled in. It runs the engine from a build made once after each update (`wrangler deploy --dry-run` into `state/build/engine`, never sent anywhere), in the local Workers runtime with the same local database, queue and files as `wrangler dev`, and nothing watches the files: an edit here changes nothing until the next start, which builds again. **When you work on the engine, start Open Sourcebook with `npm start -- --dev`**: the engine runs in `wrangler dev` and reloads as you save, and so does the web app. What follows is for working on the engine alone.

```bash
npm install
cp .dev.vars.example .dev.vars   # the client token; a model key only if you want that way too
npm run typecheck
npm test
npm run dev -- --compatibility-flags nodejs_compat
```

The flag is needed because a package the engine uses imports `node:buffer` and `wrangler.toml` does not turn on Node's modules yet; without it `wrangler dev` stops at start. The launcher passes the same flag. `wrangler dev` always opens a debugger port that any program on this computer can attach to; the launcher instead starts the engine with `scripts/dev.ts` (the same local engine, through wrangler's own API), which keeps that port shut unless you set `OPENSOURCEBOOK_ENGINE_INSPECTOR=1`. It uses `wrangler.local.toml` instead of `wrangler.toml` when you have one. The root launcher also applies the migrations to the local database (`npx wrangler d1 migrations apply re-mvp-engine-jobs --local`) on its first start and whenever a new one appears. Local D1 keeps each database in a file named after its `database_id`, so the launcher keeps what it applied per id (`state/state.json`): when the id changes (the placeholder in `wrangler.toml`, a `wrangler.local.toml` added or taken away) the migrations run on the database now in use, and if that one is empty while an older local database beside it holds projects, the start says so in one line, with the id to put back in `wrangler.local.toml`. No database file is ever moved or deleted.

Working on the engine costs nothing on a model: your own agent makes
things through the connector, on your own subscription. Nothing in the
engine stands in for a maker; with no agent connected and no model key, the
plan says before Start what is missing and nothing is made. To have your own
Claude Code answer the chat and make flashcards and quizzes (local only), start
the connector with a token of your own and give the engine the same one:

```bash
(cd ../services/agent-connector && npm install && OPENSOURCEBOOK_CONNECTOR_TOKEN=<a long random string> npm start)
# in .dev.vars: CHAT_AGENT_URL=http://127.0.0.1:8650
#               CHAT_AGENT_TOKEN=<the same string>
```

No provider key is needed then, for the chat or for Start: with the
connector set, flashcards and quizzes are made by your agent too (below).

To have your own agent make videos as drawn scenes (local only), run the
scenes service (`services/scenes`, its README says how; it needs the agent
connector above) and give the engine its URL and token:

```bash
# in .dev.vars: SCENES_SERVICE_URL=http://127.0.0.1:<its port>
#               SCENES_SERVICE_TOKEN=<the token it was started with>
```

Tests run on Node (vitest). Store, repository and runner tests use SQLite
(`node:sqlite`) with every migration file applied, so the SQL, foreign keys
and unique constraints are the real ones. Fakes for D1, R2, extractors,
model providers, the connector, the scenes service and engines live in
`tests/support`, never in `src`, and no setting turns one on.

`.github/workflows/engine.yml` runs typecheck and tests on every push that
touches `engine/`.
