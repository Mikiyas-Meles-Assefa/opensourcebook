/**
 * The end card's words, laid out before it is drawn: what it says, at what size, on how many lines, and how long it
 * stays. Pure, so the render, the timeline and the tests read the same numbers.
 *
 * It is read on a phone held upright, in a few seconds and with no voice over it, so it says little, and only what a
 * viewer wants at the end: what the video was, and where it came from. The video's title, the sources by name under
 * "Source", and the credits of pictures from elsewhere under "Pictures". How many quotes were taken and that each was
 * checked is Open Sourcebook talking about itself, not the viewer's question: the item's own page shows every cite at its claim. Every line is at least `LEAST` pixels tall on a 1080 wide frame (about 13 points on a phone 390 points
 * wide; 11 is the smallest text a phone uses), and everything fits inside the card's box: what does not fit at that
 * size is counted ("and 3 more") rather than cut by the edge.
 */
import type { Credits } from "../schemas/project.ts";

/** The card's box on a 1080 by 1920 frame: clear of the edges, and above the band the captions use. */
export const CARD = { left: 110, width: 860, top: 140, height: 1380 };
/** The smallest line on the card, in pixels of a 1080 wide frame. */
export const LEAST = 36;
/** Reading the card: about three words a second (subtitle guidelines put viewers at 160 to 180 a minute), after a glance. */
const READ_WORDS_PER_SECOND = 3;
const GLANCE_SECONDS = 1.5;
export const CARD_SECONDS = { least: 5, most: 7 };
/**
 * How far the card rises over its time on screen, in pixels of a 1920 tall frame. It holds for 5 to 7 s, often with no
 * music under it, and a picture that stands still and silent that long reads as a frozen video; a slow, even rise keeps
 * it alive without making it harder to read, and it starts in place, so the first frame is as legible as the last.
 */
export const CARD_RISE = 40;

export type CardLine = { text: string; size: number; role: "title" | "heading" | "source" | "credit" | "more"; gap: number };

/**
 * An estimate of a line's width: an average letter is a little over half its size wide in the body faces the styles
 * use, capitals and wide letters more. It errs wide, so a line it lets through fits.
 */
export function widthOf(text: string, size: number, upper = false): number {
  let w = 0;
  for (const c of upper ? text.toUpperCase() : text) w += /[il.,:;'!|() ]/.test(c) ? 0.3 : /[mwMW@%]/.test(c) ? 0.95 : /[A-Z0-9]/.test(c) ? 0.7 : 0.58;
  return w * size;
}

/** Words broken over lines no wider than `width`; a word wider than the line is made to fit by the caller's size. */
export function wrap(text: string, size: number, width: number, upper = false): string[] {
  const out: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && widthOf(next, size, upper) > width) {
      out.push(line);
      line = word;
    } else line = next;
  }
  if (line) out.push(line);
  return out;
}

/** The largest size from `most` down to `least` at which the words fit on one line of the card; `least` when none does. */
export function oneLine(text: string, most: number, least: number): number {
  for (let size = most; size > least; size--) if (widthOf(text, size) <= CARD.width) return size;
  return least;
}

/** The heading over the sources, a word a viewer knows from any book or film: where it came from. */
export const sourcesHeading = (count: number) => (count === 1 ? "Source" : "Sources");

/** Two names that read the same to a viewer: case, spacing and the punctuation around them aside. */
const sameName = (a: string, b: string) => {
  const plain = (x: string) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  return plain(a) !== "" && plain(a) === plain(b);
};

/**
 * The card's lines at the largest sizes that fit its box. The title comes down from 92 to 60, the sources from 56 to
 * `LEAST`; what still does not fit is left out from the end of the pictures first, then the sources, with a line
 * saying how many.
 *
 * A source named like the video (a video made straight from one file often is) is not said twice: the title line
 * above it would make the card read "<title>, Source: <title>", which viewers took for a template left unfilled. The
 * card then opens on the heading, and a lone source takes the title's size, so it reads as what it is: the video came
 * from the source of that name.
 */
export function cardLines(c: Credits, upperTitle = false): CardLine[] {
  const sources = c.sources.map((s) => (typeof s === "string" ? { title: s } : s));
  const named = c.title?.trim() ?? "";
  const title = sources.some((src) => sameName(src.title, named)) ? "" : named;
  const lone = !title && named !== "" && sources.length === 1;
  for (let step = 0; step <= 10; step++) {
    const t = Math.round(92 - step * 3.2);
    const s = Math.round(56 - step * ((56 - LEAST) / 10));
    const small = Math.max(LEAST, Math.round(s * 0.8));
    for (let keepImages = c.images.length; keepImages >= 0; keepImages--) {
      for (let keepSources = sources.length; keepSources >= Math.min(1, sources.length); keepSources--) {
        if (keepSources < sources.length && keepImages > 0) continue; // pictures give way before sources
        const lines: CardLine[] = [];
        const put = (text: string, size: number, role: CardLine["role"], gap: number, upper = false) => {
          const rows = wrap(text, size, CARD.width, upper);
          rows.forEach((r, i) => lines.push({ text: r, size, role, gap: i === rows.length - 1 ? gap : 0 }));
          return rows.every((r) => widthOf(r, size, upper) <= CARD.width);
        };
        let fits = true;
        if (title) fits &&= put(title, t, "title", 72, upperTitle);
        if (sources.length) {
          fits &&= put(sourcesHeading(sources.length), Math.round(s * 0.85), "heading", 24, upperTitle);
          // Each source by its name, even one named like the video: the name is the citation a viewer can look up.
          sources.slice(0, keepSources).forEach((src, i) => (fits &&= put(src.title, lone ? t : s, "source", i === keepSources - 1 ? 0 : 20)));
          if (keepSources < sources.length) fits &&= put(`and ${sources.length - keepSources} more`, small, "more", 0);
          lines.at(-1)!.gap = 64;
        }
        if (c.images.length && keepImages) {
          fits &&= put("Pictures", Math.round(s * 0.85), "heading", 24, upperTitle);
          c.images.slice(0, keepImages).forEach((img) => (fits &&= put(img, small, "credit", 14)));
        }
        if (c.images.length && keepImages < c.images.length) fits &&= put(`and ${c.images.length - keepImages} more ${c.images.length - keepImages === 1 ? "picture" : "pictures"}`, small, "more", 0);
        if (lines.length) lines.at(-1)!.gap = 0;
        if (fits && heightOf(lines) <= CARD.height) return lines;
      }
    }
  }
  // Nothing fits even at the least size: the title alone, made to fit.
  return named ? wrap(named, 60, CARD.width, upperTitle).slice(0, 4).map((text) => ({ text, size: 60, role: "title" as const, gap: 0 })) : [];
}

/** Line height on the card, as a share of the size. */
export const LEADING = 1.25;
export const heightOf = (lines: CardLine[]) => lines.reduce((h, l) => h + l.size * LEADING + l.gap, 0);

/** How far the card has risen at `frame` of its `frames`: 0 on its first frame, `CARD_RISE` on its last, evenly between, so it never stops. */
export function cardRise(frame: number, frames: number): number {
  if (frames <= 1) return 0;
  return (CARD_RISE * Math.min(Math.max(frame, 0), frames - 1)) / (frames - 1);
}

/** How long the card stays: long enough to read its title and sources at three a second after a glance (picture credits are there to be found, not read through), from 5 to 7 s. */
export function cardSeconds(c: Credits): number {
  const words = cardLines(c).filter((l) => l.role !== "credit").reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0);
  const s = GLANCE_SECONDS + words / READ_WORDS_PER_SECOND;
  return Math.round(Math.min(CARD_SECONDS.most, Math.max(CARD_SECONDS.least, s)) * 10) / 10;
}
