import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { useNavigate } from "react-router";
import type { Cite, Json, Message, Source, ThreadAbout } from "../api/types";
import { errorText, isApiError } from "../api/errors";
import { useApi, useFormats } from "../app/context";
import { useLoad } from "../app/useLoad";
import { PrimaryButton } from "../design/Buttons";
import { Icon } from "../design/Icon";
import { MakerPicker, type MakerPick } from "../make/MakerPicker";
import { isPickNeeded, PICK_MAKER } from "../make/pickNeeded";
import { citeLink } from "../player/progress";
import { AgentSteps } from "../project/AgentSteps";
import { Reply } from "../project/ChatPanel";
import { agentProblem, failedReply, failedText, runningReply } from "../project/pieces";
import { announceRemake, remakeLive, sceneNumber, sceneOf, sceneWords, useRemake } from "./remake";
import { RemakeMaking } from "./RemakeMaking";
import { useThread } from "./useThread";
import "../project/project.css";
import "./thread.css";

/** A dragged sheet further down than this lets go and closes. */
const DISMISS_PX = 90;

/**
 * The thread on one made thing (engine/docs/api.md, "Threads"): a place to
 * ask about it or say what looks wrong, at the spot the person is at, and
 * the answers. It opens and closes on the thing, beside it (`side`, the
 * Studio) or as a sheet over the lower part (`sheet`, a phone), so the
 * thing stays in view. Each message here is a message of the chat that
 * made the thing, and its reply shows in both; this shows only the ones
 * about this thing, newest at the bottom, each with the spot it was written
 * at (tapping it takes the player there). A reply being written shows its
 * live step and its blocks as they land, as the chat does.
 */
export function Thread({
  planId,
  itemId,
  projectId,
  title,
  where,
  variant,
  onClose,
  onJump,
  onOpenChat,
  onOpenCite,
  ask,
  onSent,
  outputId,
}: {
  planId: string;
  itemId: string;
  projectId: string;
  title: string;
  /** The format's label ("quiz"); players still pass it, the header no longer says it. */
  kind?: string;
  /** Where the person is in the thing now, in its player's own shape. */
  where: () => Json | undefined;
  variant: "side" | "sheet";
  onClose: () => void;
  /** Takes the player to a spot a message was written at. */
  onJump?: (at: Json) => void;
  /** Opens the chat this thread lives in; without it, a link to the project with that chat. */
  onOpenChat?: (chatId: string) => void;
  /** Opens a cited spot; without it, the cite's own page. */
  onOpenCite?: (cite: Cite) => void;
  /** Asked from a spot (a quiz's answer): the composer takes the focus, written about that spot. `n` changes per ask. */
  ask?: { n: number; at: Json };
  /** A message was sent into that chat: counts change, and the chat has a new message. */
  onSent?: (chatId: string) => void;
  /** The made thing being looked at; the item's newest when left out. */
  outputId?: string;
}) {
  const client = useApi();
  const navigate = useNavigate();
  const pinned = useRef<Json | undefined>(undefined);
  const thread = useThread(planId, itemId, () => pinned.current ?? where());
  const [text, setText] = useState("");
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const headId = useId();
  const sources = useLoad(() => client.all((q) => client.projectSources(projectId, q)), [client, projectId]);
  const sourceById = useMemo(() => new Map<string, Source>((sources.data ?? []).map((s) => [s.id, s])), [sources.data]);
  const openCite = onOpenCite ?? ((c: Cite) => navigate(citeLink(c.sourceId, c.quote, c.locator)));
  // The moment the thread was opened at: a remake is of the scene playing then. A thread open before the player
  // says which scene is playing (opened with the page) takes the first one it says.
  const [opened, setOpened] = useState(where);
  const placed = sceneOf(opened) !== undefined;
  const whereNow = useRef(where);
  useEffect(() => {
    whereNow.current = where;
  });
  useEffect(() => {
    if (placed) return;
    const timer = window.setInterval(() => {
      const at = whereNow.current();
      if (sceneOf(at)) setOpened(at);
    }, 500);
    return () => window.clearInterval(timer);
  }, [placed]);
  const thing = outputId ?? thread.item?.outputId;

  // Asked from a spot: that spot stays the one written about until the message is sent.
  useEffect(() => {
    if (!ask) return;
    pinned.current = ask.at;
    box.current?.focus();
  }, [ask]);

  // Newest at the bottom, and kept in view as a reply lands.
  const [remakeFoot, setRemakeFoot] = useState(0);
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.messages, remakeFoot]);

  async function submit() {
    const words = text.trim();
    if (!words || thread.sending) return;
    const at = pinned.current;
    const chatId = await thread.send(words, at);
    if (chatId) {
      setText("");
      pinned.current = undefined;
      onSent?.(chatId);
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void submit();
    }
    if (e.key === "Escape") onClose();
  }

  // A sheet is dragged down by its top to put it away.
  const drag = useRef<{ y: number; dy: number } | undefined>(undefined);
  function down(e: PointerEvent<HTMLElement>) {
    if (variant !== "sheet" || (e.target as HTMLElement).closest("button, a")) return;
    drag.current = { y: e.clientY, dy: 0 };
    e.currentTarget.setPointerCapture?.(e.pointerId);
  }
  function move(e: PointerEvent<HTMLElement>) {
    const d = drag.current;
    if (!d || !sheet.current) return;
    d.dy = Math.max(0, e.clientY - d.y);
    sheet.current.style.transform = `translateY(${d.dy}px)`;
  }
  function up() {
    const d = drag.current;
    drag.current = undefined;
    if (!d || !sheet.current) return;
    sheet.current.style.transform = "";
    if (d.dy > DISMISS_PX) onClose();
  }

  const busy = isApiError(thread.error) && thread.error.code === "chat_busy";
  const chat = thread.chat;
  return (
    <div ref={sheet} className={`thread ${variant}`} role={variant === "sheet" ? "dialog" : "complementary"} aria-label={`Talk about ${title}`} aria-describedby={headId}>
      <header className="thd" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        {variant === "sheet" && <span className="grab" aria-hidden="true" />}
        <div className="tht">
          <b id={headId}>Talk about this</b>
          <small className="tmoment">{thread.here ?? title}</small>
        </div>
        <button type="button" className="tclose" aria-label="Close" title="Close" onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="tlist" ref={list} aria-live="polite">
        {!thread.loaded && <p className="tnote">Reading…</p>}
        {thread.loaded && thread.messages.length === 0 && <p className="tnote">Ask about where you are in it, or say what looks wrong. Open Sourcebook checks the source and answers here and in its chat.</p>}
        {thread.messages.map((m) => (
          <ThreadMessage key={m.id} m={m} sourceById={sourceById} onOpenCite={openCite} {...(onJump ? { onJump } : {})} />
        ))}
        {thing && (
          <RemakeFoot
            planId={planId}
            itemId={itemId}
            outputId={thing}
            scene={sceneOf(opened)}
            said={[...thread.messages].reverse().find((m) => m.role === "user")?.text.trim() || undefined}
            onGrow={() => setRemakeFoot((n) => n + 1)}
          />
        )}
      </div>
      <form
        className="tform"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="tbox">
          <textarea
            ref={box}
            className="tarea"
            rows={1}
            value={text}
            placeholder="Ask about this moment, or disagree"
            aria-label={`Write about ${title}`}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
          />
          <div className="tfoot">
            <span className="tsaved">{chat ? `Also saved in your chats as “${chat.title ?? "Untitled chat"}”` : "Also saved in your chats"}</span>
            {chat &&
              (onOpenChat ? (
                <button type="button" className="link" onClick={() => onOpenChat(chat.id)}>
                  Open in the chat
                </button>
              ) : (
                <a className="link" href={`/projects/${encodeURIComponent(projectId)}?chat=${encodeURIComponent(chat.id)}`}>
                  Open in the chat
                </a>
              ))}
            <button type="submit" className="tsend" aria-label="Send" disabled={!text.trim() || thread.sending}>
              <Icon name="up" />
            </button>
          </div>
        </div>
        {thread.error !== undefined && <small className="terr">{busy ? "Its chat is answering something else. Send again in a moment." : errorText(thread.error)}</small>}
      </form>
    </div>
  );
}

/**
 * The foot of a thread on a thing one of whose scenes can be made again: a
 * way to have the scene playing when the thread was opened made again: a note
 * of what should change, filled in with the person's last message when there
 * is one and theirs to change, made only when they confirm it; then that
 * scene being made, with Stop, and Try again if it failed. The thing they
 * have stays until the new one is ready.
 */
function RemakeFoot({ planId, itemId, outputId, scene, said, onGrow }: { planId: string; itemId: string; outputId: string; scene: string | undefined; said: string | undefined; onGrow: () => void }) {
  const client = useApi();
  const formats = useFormats();
  const output = useLoad(() => client.getOutput(outputId), [client, outputId]).data;
  const can = output?.remakesScene === true;
  const remake = useRemake(can ? planId : undefined, itemId, outputId);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  // Several agents are ready and none is picked for this: who makes it is asked, then it is made with that pick.
  const [picking, setPicking] = useState<{ note: string | undefined }>();
  const [started, setStarted] = useState<string>();
  const format = formats.find((f) => f.id === output?.type);
  const going = remakeLive(remake.remaking);
  const shown = `${can}${asking}${started ?? ""}${remake.remaking?.job.status ?? ""}${error ? 1 : 0}`;
  const grow = useRef(onGrow);
  useEffect(() => {
    grow.current = onGrow;
  });
  useEffect(() => grow.current(), [shown]);
  if (!can || !output) return null;
  const n = scene ? sceneNumber(output.payload, scene) : undefined;

  async function start(words: string | undefined, pick?: MakerPick) {
    if (!scene) return;
    setBusy(true);
    setError(undefined);
    try {
      const r = await client.remakeScene(outputId, scene, { ...(words ? { note: words } : {}), ...(pick ?? {}) });
      remake.begin({ outputId, scene, ...(words ? { note: words } : {}), job: { ...r.job, attempt: 1 } });
      setStarted(sceneWords(n));
      setAsking(false);
      setNote("");
      setPicking(undefined);
      announceRemake(planId, itemId);
    } catch (e) {
      if (isPickNeeded(e)) setPicking({ note: words });
      else setError(e);
    } finally {
      setBusy(false);
    }
  }
  function press() {
    setError(undefined);
    setNote(said ?? "");
    setAsking(true);
  }

  const thingWord = format?.label ?? output.type;
  return (
    <div className="tremake">
      {scene && !remake.remaking && !asking && (
        <button type="button" className="mini tremake-go" disabled={busy} onClick={press}>
          Remake this scene
        </button>
      )}
      {asking && (
        <form
          className="tremake-box"
          aria-label="What should change?"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) void start(note.trim());
          }}
        >
          <label>
            <b>What should change?</b>
            <textarea
              rows={2}
              value={note}
              autoFocus
              placeholder={`What is wrong in ${sceneWords(n)}, or how it should be`}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setAsking(false);
                }
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  if (note.trim() && !busy) void start(note.trim());
                }
              }}
            />
          </label>
          {said && <small className="tremake-hint">Your last message is the note. Change it if you like.</small>}
          <div className="tremake-row">
            <button type="button" className="link" onClick={() => setAsking(false)}>
              Cancel
            </button>
            <PrimaryButton type="submit" disabled={!note.trim() || busy}>
              Remake {sceneWords(n)}
            </PrimaryButton>
          </div>
        </form>
      )}
      {started && going && (
        <p className="tremake-said">
          Making {started} again. The {thingWord} you have stays until the new one is ready.
        </p>
      )}
      {remake.remaking && <RemakeMaking planId={planId} itemId={itemId} remaking={remake.remaking} {...(remake.remaking.outputId === output.id ? { payload: output.payload } : {})} onChanged={remake.read} />}
      {error !== undefined && <small className="terr">{remakeError(error)}</small>}
      {picking && (
        <MakerPicker
          scope={output.type}
          value={null}
          note={PICK_MAKER}
          onChange={(pick) => pick && void start(picking.note, pick)}
          onClose={() => setPicking(undefined)}
        />
      )}
    </div>
  );
}

/** What a refused remake says: the engine's own words when it cannot, and that one is being made when it is. */
function remakeError(e: unknown): string {
  if (isApiError(e, "being_made")) return "One is already being made. Wait for it to be ready, or stop it, then try again.";
  return errorText(e);
}

/** One message of a thread: the person's with the spot it was written at, or the reply, drawn as the chat draws it. */
function ThreadMessage({ m, sourceById, onOpenCite, onJump }: { m: Message; sourceById: Map<string, Source>; onOpenCite: (cite: Cite) => void; onJump?: (at: Json) => void }) {
  if (m.role === "user") {
    const at = m.about?.at;
    return (
      <div className="tme">
        <div className="m me">{m.text}</div>
        {at !== undefined && (
          <button type="button" className="tat" disabled={!onJump} onClick={() => onJump?.(at)} title="Go there">
            {m.about?.label ?? "where you were"}
          </button>
        )}
      </div>
    );
  }
  if (runningReply(m)) {
    return (
      <div className="tai">
        <AgentSteps steps={m.steps ?? []} running startedAt={m.createdAt} />
        {(m.pieces?.length ?? 0) > 0 && <Reply message={m} sourceById={sourceById} onOpenCite={onOpenCite} planCard={madeLine} picked={() => []} onPick={() => undefined} onSendPicks={() => undefined} disabled writing />}
      </div>
    );
  }
  const problem = agentProblem(m);
  const failed = failedReply(m);
  if (problem || failed) return <p className="ai failed tfail">{problem?.text ?? failedText(failed!, m.text)}</p>;
  return (
    <div className="tai">
      <Reply message={m} sourceById={sourceById} onOpenCite={onOpenCite} planCard={madeLine} picked={() => []} onPick={() => undefined} onSendPicks={() => undefined} disabled />
    </div>
  );
}

/** A thing the reply made or remade, as one line here; the chat and the Studio show it whole. */
function madeLine(piece: { made?: "made" | "remade" }): ReactNode {
  return <small className="tmade">{piece.made === "remade" ? "Being remade: the new one shows in the Studio when it is ready." : "Made in its chat; see it there."}</small>;
}

/**
 * The quiet way to talk about a spot, drawn in a player's slot (a quiz,
 * under an answer's explanation): it opens the thread at that spot.
 */
export function AskHere({ onAsk }: { onAsk: () => void }) {
  return (
    <button type="button" className="askhere" onClick={onAsk}>
      <Icon name="chat" />
      Ask about this, or disagree
    </button>
  );
}

/** The button that opens and closes a thing's thread, with how many messages it holds. */
export function ThreadButton({ count, open, onToggle, className = "" }: { count: number; open: boolean; onToggle: () => void; className?: string }) {
  return (
    <button type="button" className={`tbtn ${className}`} aria-pressed={open} aria-label={count ? `Talk about this: ${count} message${count === 1 ? "" : "s"}` : "Talk about this"} title="Talk about this" onClick={onToggle}>
      <Icon name="chat" />
      {count > 0 && <span className="tcount">{count}</span>}
    </button>
  );
}

/** Where a chat message written in a thread came from, with a way back to that spot ("On the quiz X · question 2"). */
export function ThreadMark({ about, kind, onOpen }: { about: ThreadAbout; kind: string; onOpen?: (about: ThreadAbout) => void }) {
  const words = `On the ${kind} “${about.title}”${about.label ? `, ${about.label}` : ""}`;
  return onOpen && about.output ? (
    <button type="button" className="tmark" onClick={() => onOpen(about)} title="Open it there">
      <Icon name="chat" />
      {words}
    </button>
  ) : (
    <small className="tmark">
      <Icon name="chat" />
      {words}
    </small>
  );
}

/** How many messages a thing's thread holds, quietly, on a row of a list. */
export function TalkCount({ n }: { n: number }) {
  return (
    <span className="tsmall" title={`${n} message${n === 1 ? "" : "s"} about it`} aria-label={`${n} message${n === 1 ? "" : "s"} about it`}>
      <Icon name="chat" />
      {n}
    </span>
  );
}
