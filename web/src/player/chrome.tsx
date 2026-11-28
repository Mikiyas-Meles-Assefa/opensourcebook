import { useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "../design/Icon";
import { ThreadButton } from "../thread/Thread";
import { createPortal } from "react-dom";
import { ChromeSink, ChromeSlotActive, ChromeToolsTarget, useStepGestures, type ChromeReport, type Segment, type Sink } from "./useChrome";
import "./chrome.css";

export type { ChromeReport, Segment } from "./useChrome";

/**
 * Where one player sits inside a chrome. Only an `active` slot's report
 * reaches the chrome (a feed draws its neighbours too); a slot that becomes
 * active hands over what its player last said. It also keeps its player
 * clear of the floating bar unless the player draws under it.
 */
export function ChromeSlot({ active = true, onReport, className = "", children }: { active?: boolean; onReport: Sink; className?: string; children: ReactNode }) {
  const last = useRef<ChromeReport | undefined>(undefined);
  const live = useRef(active);
  const tell = useRef(onReport);
  useLayoutEffect(() => {
    tell.current = onReport;
  });
  const [behind, setBehind] = useState<ChromeReport["behind"]>();
  const sink = useCallback<Sink>((r) => {
    last.current = r;
    setBehind(r?.behind);
    if (live.current) tell.current(r);
  }, []);
  useEffect(() => {
    live.current = active;
    if (active) tell.current(last.current);
  }, [active]);
  return (
    <ChromeSink.Provider value={sink}>
      <ChromeSlotActive.Provider value={active}>
        <div className={`pc-slot${behind ? " behind" : ""} ${className}`}>{children}</div>
      </ChromeSlotActive.Provider>
    </ChromeSink.Provider>
  );
}

/** A control in the bar that goes somewhere or does something. */
export type ChromeAction = { label: string; to: string; onClick?: undefined } | { label: string; onClick: () => void; to?: undefined };

/**
 * The chrome every player wears (docs/inspo HANDOFF, "Players"): the player
 * fills the frame; floating on top are back, the title, talk, done and full
 * view; a thin line along the bottom says how far through. Scroll, swipe and
 * the arrow keys go to the thing before or after when `onNext`/`onPrev` are
 * given (a plan, a feed). There are no skip buttons, no hints and no labels
 * of plan order.
 *
 * - `variant` "panel": the player in a project's right-hand panel; "phone":
 *   the whole screen of a phone, without full view; "full": the full view of
 *   a wide window, its bar a row of its own with `sub` (the project) under
 *   the title and `full` as "Exit full view".
 */
export function PlayerChrome({
  variant,
  tone,
  title,
  sub,
  back,
  full,
  talk,
  done,
  report,
  onNext,
  onPrev,
  aside,
  children,
}: {
  variant: "panel" | "phone" | "full";
  /** The colour slot of the thing's shape, from its registry entry: the line's colour on a page. */
  tone?: number | undefined;
  title: string;
  sub?: string | undefined;
  back: ChromeAction;
  /** Full view, or leaving it; absent on a phone. */
  full?: ChromeAction | undefined;
  /** The thread on this thing: its message count and whether it is open. Absent: nothing to talk about here (no plan item). */
  talk?: { count: number; open: boolean; onToggle: () => void } | undefined;
  /** The done tick of its plan item. Absent outside a plan. */
  done?: { done: boolean; onToggle: () => void } | undefined;
  /** What the player in view said (`useChrome`). */
  report?: ChromeReport | undefined;
  /** Goes on to the next thing; absent when there is nothing to go to. */
  onNext?: (() => void) | undefined;
  onPrev?: (() => void) | undefined;
  /** Drawn beside the player (the thread on a wide window). */
  aside?: ReactNode;
  children: ReactNode;
}) {
  const main = useRef<HTMLDivElement>(null);
  const [tools, setTools] = useState<HTMLDivElement | null>(null);
  const next = () => {
    if (report?.onNext?.()) return;
    onNext?.();
  };
  const prev = () => {
    if (report?.onPrev?.()) return;
    onPrev?.();
  };
  useStepGestures(main, report?.onNext || onNext ? next : undefined, report?.onPrev || onPrev ? prev : undefined);
  const dark = report?.behind === "dark";
  const shown = report?.title || title;
  const isFull = variant === "full";
  return (
    <div className={`pchrome pc-${variant}`} style={tone ? ({ "--pc-tone": `var(--fmt-${tone}-fg)` } as CSSProperties) : undefined}>
      <section ref={main} className={`pc-main${dark ? " dark" : ""}${report?.behind ? " behind" : ""}`} aria-label={`Playing: ${shown}`}>
        <div className="pc-stage">
          <ChromeToolsTarget.Provider value={tools}>{children}</ChromeToolsTarget.Provider>
        </div>
        <header className="pc-bar">
          {isFull && full ? (
            <ChromeLink action={full} className="pc-exit">
              <Icon name="shrink" />
              {full.label}
            </ChromeLink>
          ) : (
            <ChromeLink action={back} className="pc-ib" aria-label={back.label} title={back.label}>
              <Icon name="chev-l" />
            </ChromeLink>
          )}
          <div className="pc-title">
            <h1>{shown}</h1>
            {isFull && sub && <small>{sub}</small>}
          </div>
          <div className="pc-tools" ref={setTools} />
          {talk && <ThreadButton className="pc-ib pc-talk" count={talk.count} open={talk.open} onToggle={talk.onToggle} />}
          {done && (
            <button type="button" className={`pc-ib pc-done${done.done ? " on" : ""}`} aria-label="Done" aria-pressed={done.done} title={done.done ? "Done. Press again to undo." : "Mark done"} onClick={done.onToggle}>
              <Icon name="done" />
            </button>
          )}
          {!isFull && full && (
            <ChromeLink action={full} className="pc-ib" aria-label={full.label} title={full.label}>
              <Icon name="expand" />
            </ChromeLink>
          )}
        </header>
        <ChromeLine report={report} />
      </section>
      {aside}
    </div>
  );
}

/**
 * A player's own tools, drawn in the chrome's floating bar before talk
 * (a guide's "Change it" and "Print"). Only the player in view shows its
 * tools; outside a chrome nothing is drawn.
 */
export function ChromeTools({ children }: { children: ReactNode }) {
  const target = useContext(ChromeToolsTarget);
  const active = useContext(ChromeSlotActive);
  return target && active ? createPortal(children, target) : null;
}

/**
 * The chrome's thin line on its own, as the player in view said it: in
 * pieces, or how far through. A place that holds players without the bar
 * (the phone's feed) draws it under each one.
 */
export function ChromeLine({ report }: { report: ChromeReport | undefined }) {
  if (report?.segments) return <SegmentLine segments={report.segments} />;
  return report?.progress !== undefined ? <ProgressLine progress={report.progress} marks={report.marks} onSeek={report.onSeek} /> : null;
}

/**
 * Where a player's own tools go (`ChromeTools`), for a place that holds
 * players without the bar: the element they are drawn into.
 */
export function ChromeToolsHere({ target, children }: { target: HTMLElement | null; children: ReactNode }) {
  return <ChromeToolsTarget.Provider value={target}>{children}</ChromeToolsTarget.Provider>;
}

/** The line in equal pieces, one per step, each in its state (see `Segment`). */
export function SegmentLine({ segments }: { segments: Segment[] }) {
  const done = segments.filter((s) => s !== "todo" && s !== "now").length;
  return (
    <div className="pc-line pc-segs" role="progressbar" aria-label="Where you are" aria-valuemin={0} aria-valuemax={segments.length} aria-valuenow={done}>
      {segments.map((s, i) => (
        <span key={i} className={`pc-seg ${s}`} />
      ))}
    </div>
  );
}

function ChromeLink({ action, className, children, ...aria }: { action: ChromeAction; className: string; children: ReactNode; "aria-label"?: string; title?: string }) {
  return action.to !== undefined ? (
    <Link className={className} to={action.to} {...aria}>
      {children}
    </Link>
  ) : (
    <button type="button" className={className} onClick={action.onClick} {...aria}>
      {children}
    </button>
  );
}

/** The thin line along the bottom: how far through, broken where parts begin; a control when the player can move to a point. */
export function ProgressLine({ progress, marks = [], onSeek }: { progress: number; marks?: number[] | undefined; onSeek?: ((fraction: number) => void) | undefined }) {
  // While the person drags, the bar follows the pointer: the video keeps
  // reporting its old position until the seek lands, and a value taken from
  // it would pull the thumb back under the pointer. The seek happens on release.
  const [scrub, setScrub] = useState<number | null>(null);
  const scrubbing = useRef(false);
  const shown = scrub ?? Math.round(progress * 1000);
  const at = `${shown / 10}%`;
  return (
    <div className="pc-line" style={{ "--at": at } as CSSProperties}>
      <i />
      {marks.filter((m) => m > 0 && m < 1).map((m) => (
        <span key={m} className="pc-mark" style={{ left: `${m * 100}%` }} />
      ))}
      {onSeek ? (
        <input type="range" aria-label="Where you are" min={0} max={1000} step={1} value={shown} aria-valuetext={`${shown / 10}%`} onChange={(e) => { const value = Number(e.target.value); if (scrubbing.current) setScrub(value); else onSeek(value / 1000); }} onPointerDown={() => { scrubbing.current = true; }} onPointerUp={(e) => { if (!scrubbing.current) return; scrubbing.current = false; setScrub(null); onSeek(Number(e.currentTarget.value) / 1000); }} onPointerCancel={() => { scrubbing.current = false; setScrub(null); }} />
      ) : (
        <span className="sr-only" role="progressbar" aria-label="Where you are" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress * 100)} />
      )}
    </div>
  );
}

