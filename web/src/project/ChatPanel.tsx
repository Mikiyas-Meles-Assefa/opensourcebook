import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Answer, Chat, ChatCommand, Cite, Json, MakePiece, Message, PlanPiece, PlanView, Project, QuestionPiece, Source, ThreadAbout } from "../api/types";
import { useApi, useAppData, useFormats, useProviders } from "../app/context";
import { errorText, isApiError } from "../api/errors";
import { Confirm } from "../app/Confirm";
import { ErrorNotice, LoadState } from "../app/Status";
import { CopyButton } from "../design/Buttons";
import { Icon } from "../design/Icon";
import { PlanCard, PlanUnderway } from "../plan/PlanCard";
import { PlanProvider } from "../plan/PlanProvider";
import { AddSourcesDialog } from "../sources/AddSources";
import { mentionables, mentionsIn, splitCommand, splitMentions, type Mentionable } from "./mentions";
import { AgentSteps } from "./AgentSteps";
import { MadeRow } from "./MadeRow";
import { copySelection } from "./copy";
import { agentProblem, answerText, canRetry, citeNumbers, copyText, failedReply, failedText, isMake, isPlan, isQuestion, pieceViews, piecesOf, runningReply, shownBeforeFailure } from "./pieces";
import { useRightPanel, useRightViewRenderer } from "./rightPanel";
import { loadNewChatTicks, saveNewChatTicks, tickedIds, usable } from "./ticks";
import { ChatActionsContext, type ChatActions } from "./chat/actions";
import { ChatMenu } from "./chat/ChatMenu";
import { ChatPicker } from "./chat/ChatPicker";
import { Composer } from "./chat/Composer";
import { PlanInChat } from "./chat/PlanInChat";
import { pickerState } from "./chat/providerLoad";
import { chatCommandOf } from "./chat/commands";
import { SourcesChip } from "./chat/SourcesPop";
import { ThreadMark } from "../thread/Thread";
import { pickIdOf } from "../make/madeBy";
import { MakerPicker } from "../make/MakerPicker";
import { isPickNeeded, PICK_CHAT } from "../make/pickNeeded";
import { localDay } from "../plan/days";
import "./chat/chat.css";

interface PlansState {
  views?: PlanView[];
  error: unknown;
  set: (v: PlanView) => void;
  /** Reads every plan again (after a chat is deleted, its plans change). */
  reload?: () => Promise<void>;
}

/**
 * A message on screen: one the engine stored, or the person's while the reply is
 * written. A pending message with an `error` never reached the engine; it stays on
 * screen with Try again instead of vanishing with what was typed.
 */
type Pending = { pending: true; text: string; answer?: Answer; error?: unknown };
type Shown = Message | Pending;

/** The text and picks a person's message sent, to send again. */
function userText(m: Shown | undefined): { text: string; answer?: Answer } | undefined {
  if (!m || !("pending" in m || m.role === "user")) return undefined;
  return { text: m.text, ...(m.answer ? { answer: m.answer } : {}) };
}

/**
 * The messages on screen with fresh copies from the engine put in place, and new ones added
 * after. A message that did not change keeps the copy on screen, so nothing redraws for it.
 */
function mergeMessages(list: Shown[], fresh: Message[]): Shown[] {
  const byId = new Map(fresh.map((m) => [m.id, m]));
  const out = list.map((m) => {
    if ("pending" in m) return m;
    const next = byId.get(m.id);
    return next && JSON.stringify(next) !== JSON.stringify(m) ? next : m;
  });
  const known = new Set(out.flatMap((m) => ("pending" in m ? [] : [m.id])));
  const added = fresh.filter((m) => !known.has(m.id));
  return added.length === 0 && out.every((m, i) => m === list[i]) ? list : [...out, ...added];
}

/**
 * How often a chat is read again while the person's agent writes in it: its steps and the
 * reply's blocks as each lands. The engine has nothing to push from (tool calls write to
 * D1), so polling a small read is as fresh as a stream and simpler through the proxy.
 */
const POLL_MS = 600;

/**
 * Indexes of tries that failed and were then sent again with the same words: the
 * person's message and the failed reply after it. Only the newest try is shown.
 */
function retriedTries(messages: Shown[]): Set<number> {
  const hidden = new Set<number>();
  messages.forEach((m, i) => {
    const reply = messages[i + 1];
    const asked = userText(m);
    const failed = reply && !("pending" in reply) ? failedReply(reply) : undefined;
    if (!asked || !failed || !canRetry(failed)) return;
    const again = userText(messages[i + 2]);
    if (again && again.text === asked.text) hidden.add(i).add(i + 1);
  });
  return hidden;
}

/**
 * The chat: one saved conversation at a time, top to bottom, with the
 * typing box at the bottom (engine/docs/api.md, "Chats"). A reply is drawn
 * piece by piece, in order, each kind by its view in `pieces.ts`: text with
 * a chip per citation that opens the exact spot, a plan card, a question
 * whose options answer back. Commands (`/plan`) come from the engine's
 * skills. A chat shows only what was said and made in it; a plan no chat
 * made shows above it only when opened from the Studio, saying so. Spend is
 * not shown here: Settings has the totals. The open chat is in the address
 * (`?chat=<id>`, `?chat=new` for a new one; none opens the most recent), so a
 * chat can be linked, reloaded and reached with back and forward.
 */
export function ChatPanel({
  project,
  chat,
  onChat,
  onShown,
  sources,
  selected,
  plans,
  focus,
  onOpenCite,
  onTicked,
  onCloseFocus,
  onPlay,
  playingItem,
  playingAt,
  outbox,
  refresh,
  onTicks,
  onSourcesAdded,
}: {
  project: Project;
  /** The chat asked for in the address: an id, "new", or null for the most recent. */
  chat: string | null;
  /** Opens a chat (null: a new one); `push` adds a step to the history, else it replaces it. */
  onChat: (id: string | null, push: boolean) => void;
  /** The chat on screen once known (null: a new one), for saving its ticks. */
  onShown?: (id: string | null) => void;
  sources: Source[];
  selected: Source[];
  plans: PlansState;
  focus: string | null;
  onOpenCite: (cite: Cite) => void;
  /** The chat's ticked sources, when a chat opens or a reply changes them; undefined is all of them. */
  onTicked: (ids: string[] | undefined) => void;
  /** Puts away a plan opened from the Studio. */
  onCloseFocus: () => void;
  /** Plays a made thing in the Studio panel; `at` opens it at a spot (where a thread message was written). */
  onPlay?: (outputId: string, at?: Json) => void;
  /** A message was written into a chat from elsewhere (a thing's thread): read it again when it is the one open, and the chat list. */
  refresh?: { chatId: string; n: number };
  /** The plan item playing in the Studio, which @ suggests first, and which a follow-up such as "make it shorter" is about. */
  playingItem?: string;
  /** Where the person is in what is playing, as the Studio's player last said; the @ list says it on Playing now. */
  playingAt?: () => Json | undefined;
  /** A message another panel asks this chat to send (the Studio's plan tile), once per id. */
  outbox?: { id: number; text: string };
  /** The person changed which sources the chat reads (from its sources chip): the unticked ones. Saved with the chat. */
  onTicks?: (unselected: Set<string>) => void;
  /** Sources were added from the chat's sources chip. */
  onSourcesAdded?: () => void;
}) {
  const client = useApi();
  const panel = useRightPanel();
  const planPanel = useRightViewRenderer("plan") !== undefined;
  const [chats, setChats] = useState<Chat[]>();
  // With none named, the person picks up where they left off: the most recent chat that has something said in it.
  const chatId = chat === "new" ? null : (chat ?? (chats?.find((c) => c.messageCount > 0) ?? chats?.[0])?.id ?? null);
  // Known once the list is in, or when the address names a chat.
  const known = chat !== null || chats !== undefined;
  const [messages, setMessages] = useState<Shown[]>([]);
  const [commands, setCommands] = useState<ChatCommand[]>([]);
  // Who can answer, from the one load every screen shares: loading, failed or the engine's answer.
  const { providers, status: load, retry: retryProviders } = useProviders();
  const { refreshProviders } = useAppData();
  const [checking, setChecking] = useState(false);
  // Who answers a chat not made yet, and how hard it thinks; kept on the chat with its first message.
  const [newAnswerer, setNewAnswerer] = useState<string>();
  const [newEffort, setNewEffort] = useState<string>();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState<{ busy?: boolean; error?: unknown }>();
  const [writing, setWriting] = useState(false);
  const [error, setError] = useState<unknown>();
  // Options picked in a reply's questions, by message and question, until they are sent.
  const [picks, setPicks] = useState<Record<string, Record<string, string[]>>>({});
  // A message waiting on the person to pick who answers the chat, and the chat it goes into.
  const [askingWho, setAskingWho] = useState<{ text: string; answer?: Answer; chatId: string }>();
  const scroller = useRef<HTMLDivElement>(null);
  // A chat made by sending its first message: that send brings its messages, so it is not loaded again.
  const madeHere = useRef<string | null>(null);
  // The chat that is open now, read when a reply lands: only its own new plan opens by itself.
  const openChat = useRef(chatId);
  useEffect(() => {
    openChat.current = chatId;
  }, [chatId]);
  // Whether the person is reading the end of the chat; a reply only moves the view when they are.
  const atEnd = useRef(true);
  const views = useMemo(() => plans.views ?? [], [plans.views]);
  const byId = new Map(views.map((v) => [v.plan.id, v]));
  const current = chats?.find((c) => c.id === chatId);
  const formats = useFormats();
  const [adding, setAdding] = useState(false);
  // Words a reply's piece puts in the box (Explain it again, Ask about this idea).
  const [fill, setFill] = useState<{ id: number; text: string }>();
  // Sources that could be read; one that failed is never ticked or counted.
  const readable = useMemo(() => usable(sources), [sources]);
  const tickedSet = useMemo(() => new Set(selected.map((s) => s.id)), [selected]);
  const unselected = useMemo(() => new Set(readable.filter((s) => !tickedSet.has(s.id)).map((s) => s.id)), [readable, tickedSet]);
  const all = useMemo(
    () => mentionables(sources, views, chats ?? [], playingItem, { ticked: tickedSet, chatId, label: (f) => formats.find((x) => x.id === f)?.label ?? f, ...(playingAt ? { playingAt } : {}) }),
    [sources, views, chats, playingItem, playingAt, tickedSet, chatId, formats],
  );
  const names = all.map((m) => m.name);
  const sourceById = new Map(sources.map((s) => [s.id, s]));

  // A chat shows only what was said and made in it. A plan opened from the Studio that no listed
  // chat made (made outside a chat, or its chat is gone) is shown on its own above, saying so.
  const inChat = new Set(messages.flatMap((m) => ("pieces" in m ? piecesOf(m).filter(isPlan).map((p) => p.planId) : [])));
  const loose = views.filter((v) => v.plan.id === focus && !inChat.has(v.plan.id) && (!v.plan.chatId || (v.plan.chatId !== chatId && !chats?.some((c) => c.id === v.plan.chatId))));
  const empty = loose.length === 0 && messages.length === 0;
  // A plan's card is drawn once, on the newest piece about it: the plan as it is now.
  const cardAt = new Map<string, string>();
  for (const m of messages) if (!("pending" in m)) piecesOf(m).forEach((p, k) => isPlan(p) && cardAt.set(p.planId, `${m.id}:${k}`));
  // Replies the person answered by picking options.
  const answeredBy = new Map<string, Answer>();
  for (const m of messages) if (!("pending" in m) && m.answer) answeredBy.set(m.answer.messageId, m.answer);
  const retried = retriedTries(messages);
  // The chat's first reply with cites says once what the numbers do.
  const firstCited = messages.find((m) => !("pending" in m) && m.role !== "user" && (m.cites?.length ?? 0) > 0 && !runningReply(m));
  const citeHintOn = firstCited && "id" in firstCited ? firstCited.id : undefined;
  // A reply the person's own agent is still writing: the chat waits for it, and shows its steps.
  const runningIds = messages.flatMap((m) => (!("pending" in m) && runningReply(m) ? [m.id] : []));
  const runningKey = runningIds.join(",");
  const busy = writing || runningIds.length > 0;

  useEffect(() => {
    let live = true;
    client
      .listChats(project.id)
      .then((list) => live && setChats(list))
      .catch((e) => live && (setChats([]), setError(e)));
    client
      .commands()
      .then((list) => live && setCommands(list))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [client, project.id]);

  // A message written into a chat from a thing's thread: the list learns a chat it made, and the open chat shows it.
  useEffect(() => {
    if (!refresh) return;
    let live = true;
    client
      .listChats(project.id)
      .then((list) => live && setChats(list))
      .catch(() => undefined);
    if (refresh.chatId === chatId)
      client
        .getChat(refresh.chatId)
        .then((r) => live && setMessages((m) => mergeMessages(m, r.messages)))
        .catch(() => undefined);
    return () => {
      live = false;
    };
    // Only a new message from elsewhere reads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh?.n]);

  // A plan focused from the Studio opens the chat that made it, once per focus.
  const owner = focus ? byId.get(focus)?.plan.chatId : undefined;
  const wanted = owner && chats?.some((c) => c.id === owner) ? `${focus}:${owner}` : undefined;
  const followed = useRef<string>(undefined);
  useEffect(() => {
    if (!wanted || wanted === followed.current) return;
    followed.current = wanted;
    if (owner !== chatId) onChat(owner!, false);
    // Only a new focus moves the chat; the person may open another chat after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted]);

  // Another chat in the address (a pick, back or forward): its messages replace these.
  const [showing, setShowing] = useState(chatId);
  // While the address catches up with a chat its first message just made, that chat stays.
  const catchingUp = chatId === null && madeHere.current !== null && showing === madeHere.current;
  if (known && chatId !== showing && !catchingUp) {
    setShowing(chatId);
    if (chatId === null || chatId !== madeHere.current) {
      setMessages([]);
      setError(undefined);
    }
  }
  useEffect(() => {
    if (known) onShown?.(chatId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, chatId]);

  useEffect(() => {
    // A new chat starts with the ticks the person left on it before reloading, else every source.
    if (!known || chatId) return;
    onTicked(loadNewChatTicks(project.id));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, chatId, project.id]);

  useEffect(() => {
    if (!chatId || chatId === madeHere.current) return;
    let live = true;
    client
      .getChat(chatId)
      .then((r) => {
        if (!live) return;
        setMessages(r.messages);
        onTicked(r.chat.sources);
      })
      .catch((e) => live && setError(e));
    return () => {
      live = false;
    };
    // Only a newly opened chat moves the ticks; a callback that changes identity must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, chatId]);

  // While the agent writes, the chat is read again often: its steps, and the reply's blocks as they land.
  useEffect(() => {
    if (!chatId || !runningKey) return;
    const waiting = new Set(runningKey.split(","));
    // Only the running replies and what came after them are read again.
    const seqs = messages.flatMap((m) => (!("pending" in m) && waiting.has(m.id) ? [m.seq] : []));
    const after = seqs.length ? Math.min(...seqs) - 1 : undefined;
    let live = true;
    let reading = false;
    const timer = setInterval(() => {
      if (reading) return;
      reading = true;
      client
        .getChat(chatId, after)
        .then((r) => {
          if (!live) return;
          setMessages((m) => mergeMessages(m, r.messages));
          setChats((list) => (list ?? []).map((c) => (c.id === r.chat.id ? r.chat : c)));
          const done = r.messages.filter((m) => waiting.has(m.id) && !runningReply(m));
          if (done.length > 0) {
            void showPlans(done);
            openFresh(done);
          }
        })
        .catch(() => undefined)
        .finally(() => (reading = false));
    }, POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
    // Only which replies are running restarts the polling.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, chatId, runningKey]);

  // While a reply arrives, the view stays at the end unless the person scrolled up to read.
  useEffect(() => {
    const el = scroller.current;
    if (!el || !runningKey || typeof MutationObserver === "undefined") return;
    const observer = new MutationObserver(() => {
      if (atEnd.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, [runningKey]);

  /** The plan cards of replies that just finished, fetched once each. */
  async function showPlans(done: Message[]) {
    const ids = [...new Set(done.flatMap((m) => piecesOf(m).filter(isPlan).map((p) => p.planId)))];
    for (const id of ids) {
      try {
        plans.set(await client.getPlan(id));
      } catch {
        // The card shows when the plans load again.
      }
    }
  }

  async function stop() {
    if (!chatId) return;
    try {
      const r = await client.stopChat(chatId);
      setMessages((m) => mergeMessages(m, r.messages));
      void showPlans(r.messages);
    } catch (err) {
      setError(err);
    }
  }

  // A chat opens at its end. What the person sends shows at once; a reply that comes while
  // they read further up leaves them where they are, and a long reply shows from its start.
  const shownCount = messages.length;
  const lastMine = messages.at(-1) !== undefined && userText(messages.at(-1)) !== undefined;
  const opened = useRef<string | null>(null);
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el || shownCount === 0) return;
    const fresh = opened.current !== chatId;
    opened.current = chatId;
    if (fresh || lastMine) {
      el.scrollTop = el.scrollHeight;
      atEnd.current = true;
      return;
    }
    if (!atEnd.current) return;
    const asked = [...el.querySelectorAll<HTMLElement>(".m.me")].at(-1);
    const end = el.scrollHeight - el.clientHeight;
    const top = asked ? asked.offsetTop - el.offsetTop - 12 : end;
    el.scrollTo?.({ top: Math.min(end, Math.max(top, el.scrollTop)), behavior: "smooth" });
  }, [shownCount, writing, chatId, lastMine]);
  const loaded = plans.views !== undefined;
  useEffect(() => {
    if (focus && loaded) document.getElementById(`plan-${focus}`)?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [focus, loaded, messages.length]);

  /**
   * Sends a message. `retry` sends it again into the chat the first try made,
   * with who answers, after the engine asked for a pick (`409 pick_needed`).
   */
  async function send(text: string, answer?: Answer, retry?: { chatId: string; answerer: string; effort?: string }) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setError(undefined);
    setWriting(true);
    let tried: string | undefined;
    // A message that did not reach the engine is replaced by this try.
    setMessages((m) => [...m.filter((x) => !("pending" in x)), { pending: true, text: trimmed, ...(answer ? { answer } : {}) }]);
    try {
      let id = retry?.chatId ?? chatId;
      if (!id) {
        const made = await client.createChat(project.id);
        setChats((list) => [made, ...(list ?? [])]);
        id = made.id;
        madeHere.current = made.id;
        opened.current = made.id;
        setShowing(made.id);
        onChat(made.id, false);
        saveNewChatTicks(project.id, undefined);
      }
      const mentions = mentionsIn(trimmed, all);
      const picked = retry?.answerer ?? (chatId ? undefined : newAnswerer);
      const effort = retry ? retry.effort : chatId ? undefined : newEffort;
      tried = id;
      const r = await client.send(id, {
        text: trimmed,
        sources: selected.map((s) => s.id),
        ...(mentions.length ? { mentions } : {}),
        ...(answer ? { answer } : {}),
        ...(picked ? { answerer: picked } : {}),
        ...(effort ? { effort } : {}),
        ...(playingItem ? { opened: playingItem } : {}),
        today: localDay(),
      });
      for (const v of r.plans ?? []) plans.set(v);
      setMessages((m) => [...m.filter((x) => !("pending" in x)), ...r.messages]);
      openFresh(r.messages.filter((m) => !runningReply(m)));
      setChats((list) => [r.chat, ...(list ?? []).filter((c) => c.id !== r.chat.id)]);
      if (answer)
        setPicks((all) => {
          const rest = { ...all };
          delete rest[answer.messageId];
          return rest;
        });
      onTicked(r.chat.sources);
    } catch (err) {
      // Several agents are ready and none answers this chat yet: ask who, and send it again with that pick.
      if (isPickNeeded(err) && tried) setAskingWho({ text: trimmed, ...(answer ? { answer } : {}), chatId: tried });
      else setMessages((m) => m.map((x) => ("pending" in x ? { ...x, error: err } : x)));
    } finally {
      setWriting(false);
    }
  }

  /** Picks an option. A reply that asks one single-pick question is answered at once; otherwise picks wait for Send. */
  function pick(message: Message, question: QuestionPiece, optionId: string) {
    const questions = piecesOf(message).filter(isQuestion);
    if (questions.length === 1 && !question.multiple) {
      const answer = { messageId: message.id, picks: [{ questionId: question.id, optionIds: [optionId] }] };
      void send(answerText(message, answer), answer);
      return;
    }
    setPicks((all) => {
      const mine = all[message.id] ?? {};
      const was = mine[question.id] ?? [];
      const next = question.multiple ? (was.includes(optionId) ? was.filter((id) => id !== optionId) : [...was, optionId]) : [optionId];
      return { ...all, [message.id]: { ...mine, [question.id]: next } };
    });
  }
  function sendPicks(message: Message) {
    const mine = picks[message.id] ?? {};
    const answer = { messageId: message.id, picks: Object.entries(mine).filter(([, ids]) => ids.length > 0).map(([questionId, optionIds]) => ({ questionId, optionIds })) };
    if (answer.picks.length > 0) void send(answerText(message, answer), answer);
  }

  function open(id: string | null) {
    madeHere.current = null;
    setRenaming(false);
    setError(undefined);
    if (id !== chatId) onChat(id, true);
  }

  // Set when the person picks in the "who answers" picker, so closing it after the pick does not mark the message unsent.
  const whoPicked = { done: false };
  const pickedAnswerer = current ? current.answerer : chatId ? undefined : newAnswerer;
  const pickedEffort = current ? current.effort : chatId ? undefined : newEffort;

  /** Picks who answers, or how hard it thinks: kept on the open chat at once, or on a new chat with its first message. */
  async function pickFor(patch: { answerer: string } | { effort: string }) {
    if (!current) {
      if ("answerer" in patch) setNewAnswerer(patch.answerer);
      else setNewEffort(patch.effort);
      return;
    }
    try {
      const changed = await client.updateChat(current.id, patch);
      setChats((list) => (list ?? []).map((c) => (c.id === changed.id ? changed : c)));
    } catch (e) {
      setError(e);
    }
  }

  async function rename(title: string) {
    setRenaming(false);
    if (!current || title === (current.title ?? "")) return;
    try {
      const renamed = await client.updateChat(current.id, { title: title || null });
      setChats((list) => (list ?? []).map((c) => (c.id === renamed.id ? renamed : c)));
    } catch (e) {
      setError(e);
    }
  }

  /** Deletes the open chat, then opens the most recent other one (or a new chat); the address follows. */
  async function remove() {
    if (!current) return;
    setDeleting({ busy: true });
    try {
      await client.deleteChat(current.id);
      const rest = (chats ?? []).filter((c) => c.id !== current.id);
      setChats(rest);
      setDeleting(undefined);
      madeHere.current = null;
      onChat(rest[0]?.id ?? null, false);
      void plans.reload?.();
    } catch (e) {
      setDeleting({ error: isApiError(e, "chat_busy") ? new Error("Open Sourcebook is still writing a reply in this chat. Delete it once the reply is in.") : e });
    }
  }

  /** Which sources the chat reads, changed from its chip: the same ticks as the Sources panel, kept on the chat. */
  function changeTicks(next: Set<string>) {
    if (onTicks) return onTicks(next);
    const ids = tickedIds(sources, next);
    onTicked(ids);
    if (!chatId) saveNewChatTicks(project.id, ids);
    else void client.updateChat(chatId, { sources: ids ?? null }).catch(() => undefined);
  }

  /** A source picked from the @ list that the chat does not read is ticked, so the chat reads what was pointed at. */
  function mentioned(m: Mentionable) {
    if (!m.unticked || !m.key.startsWith("s:")) return;
    const next = new Set(unselected);
    next.delete(m.key.slice(2));
    changeTicks(next);
  }

  /** Opens the make sheet a reply proposed, filled in from it; making from it marks it made (engine/docs/api.md, "Making one thing"). */
  function openMake(piece: MakePiece, chat: string, messageId: string, index: number) {
    panel.open({
      kind: "make",
      shape: piece.format,
      prefill: {
        title: piece.title,
        about: piece.about,
        sources: piece.sources,
        settings: piece.settings,
        notices: piece.notices,
        issues: piece.issues,
        ...(piece.remakes ? { remakes: piece.remakes } : {}),
        chatId: chat,
        messageId,
        piece: index,
      },
    });
  }

  /**
   * Replies that just came in: one that proposes a thing opens its make sheet,
   * and one that wrote a plan opens it in the right column when a plan view
   * is plugged in there, only when it came in the chat that is open and the
   * column is free (no player, no make sheet). A chat opened later opens
   * nothing by itself.
   */
  function openFresh(replies: Message[]) {
    for (const m of [...replies].reverse()) {
      if (m.role !== "assistant") continue;
      const pieces = piecesOf(m);
      const k = pieces.findLastIndex((p) => isMake(p) && p.state === "open");
      if (k >= 0) return openMake(pieces[k] as MakePiece, m.chatId, m.id, k);
      const plan = pieces.findLast((p) => isPlan(p) && !p.made && p.action === "created");
      if (plan && isPlan(plan) && planPanel && (m.chatId === openChat.current || (openChat.current === null && m.chatId === madeHere.current))) return panel.offer({ kind: "plan", planId: plan.planId });
    }
  }
  // A thing made from a proposal arrives as a new plan; the chat is read again so the proposal shows what it made.
  const proposing = messages.some((m) => !("pending" in m) && piecesOf(m).some((p) => isMake(p) && p.state === "open"));
  const planCount = views.length;
  const seenPlans = useRef(planCount);
  useEffect(() => {
    if (planCount === seenPlans.current) return;
    seenPlans.current = planCount;
    if (!proposing || !chatId) return;
    let live = true;
    client
      .getChat(chatId)
      .then((r) => live && setMessages((m) => mergeMessages(m, r.messages)))
      .catch(() => undefined);
    return () => {
      live = false;
    };
    // Only a new plan reads the chat again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planCount]);

  const unreachable = pickerState(providers, load, true) === "unreachable";
  /** Asks the connector again whether the agents can be reached. */
  const checkAgain = () => {
    setChecking(true);
    void (refreshProviders?.(true) ?? Promise.resolve())
      .catch(() => undefined)
      .finally(() => setChecking(false));
  };

  const ticked = selected.map((s) => s.id);
  const card = (v: PlanView, inThisChat = true) => (
    <PlanInChat
      key={v.plan.id}
      view={v}
      card={
        <PlanProvider view={v} onChange={plans.set} sources={sources} ticked={ticked}>
          <PlanCard focused={focus === v.plan.id} inThisChat={inThisChat} {...(onPlay ? { onPlay } : {})} />
        </PlanProvider>
      }
    />
  );
  // Commands that answer in the chat and make nothing are offered on a new chat.
  const asks = commands.filter((c) => c.group === "chat");
  // A thing made at once is drawn as that thing; a plan, as its card.
  const titleOf = (planId: string | undefined) => (planId ? byId.get(planId)?.items[0]?.title : undefined);
  const made = (v: PlanView) => <MadeRow key={v.plan.id} view={v} compact onChange={plans.set} {...(onPlay ? { onPlay } : {})} {...(titleOf(v.plan.supersedesPlanId) ? { remakeOf: titleOf(v.plan.supersedesPlanId)! } : {})} />;
  const actions: ChatActions = {
    fill: (text) => setFill({ id: Date.now(), text }),
    canAgain: (reply) => chatCommandOf(reply, messages, commands) !== undefined,
    again: (reply) => {
      const c = chatCommandOf(reply, messages, commands);
      if (c) setFill({ id: Date.now(), text: `/${c.command} ` });
    },
    openMake: (piece, messageId, index) => {
      const m = messages.find((x) => !("pending" in x) && x.id === messageId);
      openMake(piece, m && !("pending" in m) ? m.chatId : (chatId ?? ""), messageId, index);
    },
    madeCard: (planId) => {
      const v = byId.get(planId);
      return v ? made(v) : null;
    },
  };

  // Another panel's message is sent once, when the chat is free.
  const sentOut = useRef<number>(undefined);
  useEffect(() => {
    if (!outbox || outbox.id === sentOut.current || busy || !known) return;
    sentOut.current = outbox.id;
    void send(outbox.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [outbox, busy, known]);


  return (
    <ChatActionsContext.Provider value={actions}>
    <section className="col chat" aria-label="Chat">
      <div className="hd">
        {renaming && current ? (
          <span className="anchor">
            <RenameChat title={current.title ?? ""} onDone={(t) => (t === undefined ? setRenaming(false) : void rename(t))} />
          </span>
        ) : (
          <ChatMenu
            chats={chats}
            chatId={chatId}
            title={current?.title || (chatId ? "Untitled chat" : "New chat")}
            onOpen={open}
            {...(current ? { onRename: () => setRenaming(true), onDelete: () => setDeleting({}) } : {})}
          />
        )}
      </div>
      {deleting && current && (
        <Confirm
          title={`Delete “${current.title || "Untitled chat"}”?`}
          action="Delete chat"
          busy={deleting.busy}
          error={deleting.error}
          onConfirm={() => void remove()}
          onCancel={() => setDeleting(undefined)}
        >
          <ChatGoes chatId={current.id} views={views} />
        </Confirm>
      )}
      <div
        className="sc"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
      >
        <LoadState loading={(plans.views === undefined && !plans.error) || chats === undefined} error={plans.error} what="the chat" />
        {empty && plans.views && chats && (
          <div className="hello">
            {readable.length > 0 && (
              <span className="hello-ic" aria-hidden="true">
                <Icon name="doc" />
              </span>
            )}
            <h2>{readable.length === 0 ? "Bring something to learn from, or just say hi." : readable.length === 1 ? `${readable[0]!.title} is read and ready` : `Your ${readable.length} sources are read and ready`}</h2>
            {readable.length > 0 && (
              <p className="lead">
                Ask anything about {readable.length === 1 ? "it" : "them"} here; every answer shows the spot it came from. To make something from {readable.length === 1 ? "it" : "them"}, pick a shape in Make.
              </p>
            )}
            {readable.length > 0 && (
              <div className="sugg">
                {asks.map((c) => (
                  <button key={c.command} type="button" className="chip" title={c.about} disabled={busy || Boolean(project.archivedAt)} onClick={() => void send(`/${c.command}`)}>
                    {c.title}
                  </button>
                ))}
                <button type="button" className="chip" disabled={busy || Boolean(project.archivedAt)} onClick={() => void send(`Summarize @${readable[0]!.title}`)}>
                  Summarize {readable[0]!.title}
                </button>
              </div>
            )}
          </div>
        )}
        {loose.map((v) => (
          <div key={v.plan.id} className="opened" role="group" aria-label="Opened, not part of this chat">
            <div className="obar">
              <small>Not part of this chat</small>
              <button className="link small" type="button" onClick={onCloseFocus}>
                Close
              </button>
            </div>
            {v.plan.direct ? made(v) : card(v, false)}
          </div>
        ))}
        {messages.map((m, i) => {
          if (retried.has(i)) return null;
          if ("pending" in m || m.role === "user") {
            const unsent = "pending" in m && m.error !== undefined;
            return (
              <Fragment key={"id" in m ? m.id : `pending-${i}`}>
                {"about" in m && m.about && <ThreadMark about={m.about} kind={formats.find((f) => f.id === m.about!.format)?.label ?? m.about.format} {...(onPlay ? { onOpen: (a: ThreadAbout) => onPlay(a.output!, a.at) } : {})} />}
                <div className={`m me${unsent ? " unsent" : ""}`}>
                  <Said text={m.text} commands={commands} names={names} />
                </div>
                {unsent && <Failed text={`Not sent: ${errorText(m.error)}`} onRetry={busy ? undefined : () => void send(m.text, m.answer)} />}
              </Fragment>
            );
          }
          // A running reply shows its live step and the blocks written so far, drawn as they will
          // stay: the same steps line and reply, in the same place, once the turn ends.
          if (runningReply(m)) {
            return (
              <Fragment key={m.id}>
                <AgentSteps steps={m.steps ?? []} running startedAt={m.createdAt} onStop={() => void stop()} />
                {(m.pieces?.length ?? 0) > 0 && <Reply message={m} sourceById={sourceById} onOpenCite={onOpenCite} planCard={() => null} picked={() => []} onPick={() => undefined} onSendPicks={() => undefined} disabled writing />}
              </Fragment>
            );
          }
          const problem = agentProblem(m);
          if (problem) {
            const asked = userText(messages[i - 1]);
            const last = i === messages.length - 1;
            // What the agent showed before it ended stays: its blocks (cut short) and any plan it made.
            const shown = shownBeforeFailure(m);
            return (
              <Fragment key={m.id}>
                <AgentSteps steps={m.steps ?? []} lines={m.stepLines} running={false} startedAt={m.createdAt} />
                {shown.length > 0 && <Reply message={{ ...m, pieces: shown }} sourceById={sourceById} onOpenCite={onOpenCite} planCard={(p) => { const v = byId.get(p.planId); return v ? (v.plan.direct ? made(v) : card(v)) : null; }} picked={() => []} onPick={() => undefined} onSendPicks={() => undefined} disabled />}
                <Failed text={problem.text} onRetry={problem.retry && asked && last && !busy && !project.archivedAt ? () => void send(asked.text, asked.answer) : undefined} />
              </Fragment>
            );
          }
          const failed = failedReply(m);
          if (failed) {
            const asked = userText(messages[i - 1]);
            const last = i === messages.length - 1;
            if (!canRetry(failed)) return <Failed key={m.id} text={failedText(failed, m.text)} />;
            return <Failed key={m.id} text="Open Sourcebook couldn't write a reply just now." detail={m.text} onRetry={asked && last && !busy && !project.archivedAt ? () => void send(asked.text, asked.answer) : undefined} />;
          }
          const answered = answeredBy.get(m.id);
          const mine = picks[m.id] ?? {};
          // Once the person has written since, a question left unanswered is passed over: its picks rest.
          const passed = !answered && messages.slice(i + 1).some((x) => userText(x) !== undefined);
          // A plan this reply shows that has since started: where it is now is said right under its card, and
          // what the reply said after the card (written before Start, "press Start…") reads as said before.
          const startedAt = piecesOf(m).findIndex((p, k) => isPlan(p) && cardAt.get(p.planId) === `${m.id}:${k}` && byId.get(p.planId)?.plan.kickedOffAt !== undefined);
          return (
            <Fragment key={m.id}>
            {m.steps && m.steps.length > 0 && <AgentSteps steps={m.steps} lines={m.stepLines} running={false} startedAt={m.createdAt} />}
            <Reply
              message={m}
              sourceById={sourceById}
              onOpenCite={onOpenCite}
              planCard={(p, k) => {
                const v = cardAt.get(p.planId) === `${m.id}:${k}` ? byId.get(p.planId) : undefined;
                if (!v) return null;
                if (v.plan.direct) return made(v);
                return (
                  <>
                    {card(v)}
                    {v.plan.kickedOffAt !== undefined && <PlanUnderway view={v} {...(onPlay ? { onPlay } : {})} />}
                  </>
                );
              }}
              picked={(q) => answered?.picks.find((x) => x.questionId === q.id)?.optionIds ?? mine[q.id] ?? []}
              {...(answered ? { answered } : {})}
              onPick={(q, o) => pick(m, q, o)}
              onSendPicks={() => sendPicks(m)}
              disabled={busy || passed || Boolean(project.archivedAt)}
              passed={passed}
              citeHint={m.id === citeHintOn}
              {...(startedAt >= 0 ? { saidBeforeStart: startedAt } : {})}
            />
            </Fragment>
          );
        })}
        {writing && (
          <div className="m ai note" role="status">
            Open Sourcebook is writing…
          </div>
        )}
        <ErrorNotice error={error} />
      </div>
      <Composer
        all={all}
        commands={commands}
        formats={formats}
        onSend={send}
        onOpen={panel.open}
        onMention={mentioned}
        disabled={Boolean(project.archivedAt) || busy}
        archived={Boolean(project.archivedAt)}
        manySources={readable.length !== 1}
        {...(fill ? { fill } : {})}
        {...(unreachable && !project.archivedAt
          ? {
              notice: (
                <div className="notice warn cnotice" role="status">
                  <span>Your agent can&apos;t be reached. Start the connector on this computer, then check again.</span>
                  <button type="button" className="obtn" disabled={checking} onClick={checkAgain}>
                    {checking ? "Checking…" : "Check again"}
                  </button>
                </div>
              ),
            }
          : {})}
        sourcesChip={<SourcesChip sources={readable} unselected={unselected} onChange={changeTicks} disabled={Boolean(project.archivedAt)} {...(project.archivedAt ? {} : { onAdd: () => setAdding(true) })} />}
        picker={
          <ChatPicker
            {...(providers ? { providers } : {})}
            load={load}
            onRetry={retryProviders}
            {...(pickedAnswerer ? { picked: pickedAnswerer } : {})}
            {...(pickedEffort ? { effort: pickedEffort } : {})}
            disabled={Boolean(project.archivedAt) || busy}
            onPick={(answerer) => void pickFor({ answerer })}
            onEffort={(effort) => void pickFor({ effort })}
          />
        }
      />
      {askingWho && (
        <MakerPicker
          scope="chat"
          value={null}
          note={PICK_CHAT}
          onChange={(pick) => {
            if (!pick) return;
            whoPicked.done = true;
            const { text, answer, chatId: into } = askingWho;
            void send(text, answer, { chatId: into, answerer: pickIdOf(pick), ...(pick.effort ? { effort: pick.effort } : {}) });
          }}
          onClose={() => {
            setAskingWho(undefined);
            if (whoPicked.done) return;
            // Closed without a pick: the message stays, unsent, with Try again.
            setMessages((m) => m.map((x) => ("pending" in x && x.error === undefined ? { ...x, error: `${PICK_CHAT}, then try again.` } : x)));
          }}
        />
      )}
      {adding && <AddSourcesDialog projectId={project.id} projectTitle={project.title} onAdded={() => onSourcesAdded?.()} onClose={() => setAdding(false)} />}
    </section>
    </ChatActionsContext.Provider>
  );
}

/** What deleting a chat takes and what stays, named from the plans it made. */
function ChatGoes({ chatId, views }: { chatId: string; views: PlanView[] }) {
  const made = views.filter((v) => v.plan.chatId === chatId);
  const goes = made.filter((v) => v.plan.kickedOffAt === undefined);
  const stays = made.filter((v) => v.plan.kickedOffAt !== undefined);
  const title = (v: PlanView) => v.plan.title || "Untitled plan";
  return (
    <>
      <p>
        {goes.length === 0
          ? "Its messages go."
          : goes.length === 1
            ? `Its messages go, and so does the plan “${title(goes[0]!)}”, which was never started.`
            : `Its messages go, and so do the ${goes.length} plans it made that were never started.`}
      </p>
      {stays.length > 0 && <p>{stays.length === 1 ? `“${title(stays[0]!)}” was started, so it stays in the Studio with everything it made.` : `${stays.length} plans it started stay in the Studio with everything they made.`}</p>}
    </>
  );
}

/** The chat's name edited in place: Enter or leaving the box saves, Escape cancels; empty goes back to no name. */
function RenameChat({ title, onDone }: { title: string; onDone: (title?: string) => void }) {
  const [text, setText] = useState(title);
  const done = useRef(false);
  const finish = (value?: string) => {
    if (done.current) return;
    done.current = true;
    onDone(value);
  };
  return (
    <form className="crename" onSubmit={(e: FormEvent) => (e.preventDefault(), finish(text.trim()))}>
      <input
        className="ipt"
        autoFocus
        aria-label="Chat name"
        maxLength={200}
        placeholder="Untitled chat"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), finish())}
        onBlur={() => finish(text.trim())}
      />
    </form>
  );
}

/**
 * What the person sent, as they meant it: a command they typed (`/plan …`)
 * shows as a tag with the command's name rather than as a raw slash word,
 * and mentioned names as tags.
 */
function Said({ text, commands, names }: { text: string; commands: ChatCommand[]; names: string[] }) {
  const said = splitCommand(text, commands);
  const rest = said ? said.rest : text;
  return (
    <>
      {said && (
        <span className="ref said" title={said.skill.about}>
          <Icon name="sparkle" />
          {capital(said.skill.title)}
        </span>
      )}
      {splitMentions(rest, names).map((p, k) => (p.mention ? <span key={k} className="ref">{p.text}</span> : p.text))}
    </>
  );
}

/** A turn that failed: what happened in a few words, the full reason on hover, and Try again when it can be. */
function Failed({ text, detail, onRetry }: { text: string; detail?: string; onRetry?: (() => void) | undefined }) {
  return (
    <div className="m ai failed" role="status">
      <Icon name="alert" />
      <span title={detail}>{text}</span>
      {onRetry && (
        <button className="retry" type="button" onClick={onRetry}>
          <Icon name="retry" />
          Try again
        </button>
      )}
    </div>
  );
}

/**
 * A reply, piece by piece in order. Pieces that read inline (text,
 * questions) share a bubble; a block piece (a plan) sits between bubbles.
 * When the reply asks more than one question, or one that takes several
 * picks, picks wait for Send.
 */
export function Reply({
  message,
  sourceById,
  onOpenCite,
  planCard,
  picked,
  answered,
  onPick,
  onSendPicks,
  disabled,
  passed,
  writing,
  citeHint = false,
  saidBeforeStart,
}: {
  message: Message;
  sourceById: Map<string, Source>;
  onOpenCite: (cite: Cite) => void;
  planCard: (piece: PlanPiece, index: number) => ReactNode;
  picked: (question: QuestionPiece) => string[];
  answered?: Answer;
  onPick: (question: QuestionPiece, optionId: string) => void;
  onSendPicks: () => void;
  disabled: boolean;
  /** The person wrote on without answering its questions. */
  passed?: boolean;
  /** The person's agent is still writing it: more blocks may come. */
  writing?: boolean;
  /** Says once, under it, what its cite numbers do. */
  citeHint?: boolean;
  /** The index of a plan card in it that has since been started: what comes after it was said before Start. */
  saidBeforeStart?: number;
}) {
  const pieces = piecesOf(message);
  const citeNumber = citeNumbers(pieces);
  const copied = writing ? "" : copyText(pieces);
  const questions = pieces.filter(isQuestion);
  const waits = questions.length > 1 || questions.some((q) => q.multiple);
  const anyPicked = questions.some((q) => picked(q).length > 0);

  // Runs of inline pieces become one bubble each; block pieces stand alone.
  const runs: Array<{ block: boolean; items: Array<{ piece: (typeof pieces)[number]; index: number }> }> = [];
  pieces.forEach((piece, index) => {
    const block = Boolean(pieceViews.get(piece.kind).block);
    const last = runs.at(-1);
    if (!block && last && !last.block) last.items.push({ piece, index });
    else runs.push({ block, items: [{ piece, index }] });
  });

  return (
    <div className="reply" onCopy={copySelection}>
      {runs.map((run, r) => {
        const drawn = run.items.map(({ piece, index }) => {
          const View = pieceViews.get(piece.kind).view;
          return (
            <Fragment key={index}>
              <View
                piece={piece}
                message={message}
                index={index}
                sourceById={sourceById}
                citeNumber={citeNumber}
                onOpenCite={onOpenCite}
                planCard={(p) => planCard(p, index)}
                picked={picked}
                {...(answered ? { answered } : {})}
                onPick={onPick}
                disabled={disabled}
              />
            </Fragment>
          );
        });
        return run.block ? (
          <Fragment key={r}>{drawn}</Fragment>
        ) : (
          <div key={r} className={`m ai${message.covered === false ? " uncovered" : ""}${saidBeforeStart !== undefined && run.items[0]!.index > saidBeforeStart ? " before" : ""}`} aria-label="Reply">
            {saidBeforeStart !== undefined && run.items[0]!.index > saidBeforeStart && <small className="saidbefore">Written before you pressed Start; the plan may have changed since</small>}
            {drawn}
          </div>
        );
      })}
      {waits && !answered && !passed && (
        <div className="asksend">
          <button className="mini go" type="button" disabled={disabled || !anyPicked} onClick={onSendPicks}>
            Send answers
          </button>
          <small className="muted">or type your own answer below</small>
        </div>
      )}
      {citeHint && (
        <small className="citehint" data-copy="skip">
          Click a number to see the exact spot in your source.
        </small>
      )}
      {copied && <CopyReply text={copied} />}
    </div>
  );
}

/** Copies a whole reply as plain text: lists as lists, tables as rows, no cite numbers. */
function CopyReply({ text }: { text: string }) {
  return (
    <div className="replytools" data-copy="skip">
      <CopyButton text={text} label="Copy reply" className="ghost" />
    </div>
  );
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
