// The end card: readable on a phone, inside its box, naming where the video came from: its sources and its pictures.
import assert from "node:assert/strict";
import { test } from "node:test";
import { CARD, CARD_RISE, CARD_SECONDS, cardLines, cardRise, cardSeconds, heightOf, LEAST, widthOf } from "../video/end-card.ts";
import { layOut, type Placed } from "../src/timeline.ts";

const fits = (lines: ReturnType<typeof cardLines>) => {
  for (const l of lines) {
    assert.ok(l.size >= LEAST, `"${l.text}" is ${l.size} px`);
    assert.ok(widthOf(l.text, l.size) <= CARD.width, `"${l.text}" is wider than the card`);
  }
  assert.ok(heightOf(lines) <= CARD.height, `the card is ${heightOf(lines)} px tall, its box ${CARD.height}`);
};

test("the card says where the video came from: the source by its name, even one named like the video, and nothing about Open Sourcebook's checks", () => {
  const lines = cardLines({ title: "How the printing press changed the price of books", sources: [{ title: "How the printing press changed the price of books", quotes: 6 }], images: [] });
  fits(lines);
  assert.deepEqual(lines.filter((l) => l.role !== "title").map((l) => l.text).join(" "), "Source How the printing press changed the price of books");
});

test("a source named like the video is said once, under its heading at the title's size, never as '<title>, Source: <title>'", () => {
  for (const [title, source] of [
    ["How a bill becomes a law in the United States", "How a bill becomes a law in the United States"],
    ["Tides", "tides."],
  ]) {
    const lines = cardLines({ title, sources: [{ title: source, quotes: 5 }], images: [] });
    fits(lines);
    // The name is on the card once, and the card opens on the heading.
    assert.equal(lines[0]!.role, "heading");
    assert.equal(lines[0]!.text, "Source");
    assert.equal(lines.filter((l) => l.role === "title").length, 0);
    const named = lines.filter((l) => l.role === "source");
    assert.equal(named.map((l) => l.text).join(" "), source);
    // At the size the title would have had, so it reads as the video's name and its origin at once, and big enough on a phone 360 wide.
    assert.ok(named.every((l) => l.size >= 60 && (l.size * 360) / 1080 >= 20), named.map((l) => l.size).join(" "));
  }
  // With another source beside it, both are listed under Sources at the sources' size, the name still said once.
  const two = cardLines({ title: "How a bill becomes a law", sources: [{ title: "How a bill becomes a law", quotes: 5 }, { title: "Congress for beginners", quotes: 3 }], images: [] });
  fits(two);
  assert.deepEqual(two.map((l) => l.text), ["Sources", "How a bill becomes a law", "Congress for beginners"]);
  // A source with another name keeps the title above it.
  const other = cardLines({ title: "Tides", sources: [{ title: "Ocean notes, chapter 3", quotes: 4 }], images: [] });
  assert.deepEqual(other.map((l) => [l.role, l.text]), [["title", "Tides"], ["heading", "Source"], ["source", "Ocean notes, chapter 3"]]);
});

test("the card reads as a plain credit to a viewer in every case: one source, several, one quote, none, long titles", () => {
  const cases = [
    { title: "Tides", sources: [{ title: "Tides", quotes: 1 }], images: [] },
    { title: "Tides", sources: [{ title: "Tides" }], images: [] },
    { title: "Tides", sources: [{ title: "Ocean notes, chapter 3", quotes: 4 }], images: ["A maker, an archive (CC BY 4.0)"] },
    { title: "How a bill becomes a law", sources: [{ title: "How a bill becomes a law", quotes: 5 }, { title: "Congress for beginners", quotes: 3 }], images: [] },
    { title: "A title long enough that it needs more than one line on a phone held upright", sources: [{ title: "A chapter title that is just as long as the video's own title, or longer still", quotes: 12 }], images: [] },
  ];
  for (const c of cases) {
    const lines = cardLines(c);
    fits(lines);
    const text = lines.map((l) => l.text).join(" / ");
    // Nothing that sounds like the app talking about itself: no counts of quotes, no checking, no "your".
    assert.doesNotMatch(text, /quote|checked|word for word|same name|your source/i, text);
    // Read on a phone 360 pixels wide, no line is under 12 pixels.
    for (const l of lines) assert.ok((l.size * 360) / 1080 >= 12, `${l.text}: ${l.size}`);
    const heading = lines.find((l) => l.role === "heading")!;
    assert.equal(heading.text, c.sources.length === 1 ? "Source" : "Sources");
    // Every source is named, whole, in order.
    assert.equal(lines.filter((l) => l.role === "source").map((l) => l.text).join(" "), c.sources.map((x) => x.title).join(" "), text);
  }
  const several = cardLines(cases[3]!).map((l) => l.text);
  assert.ok(several.includes("How a bill becomes a law") && several.includes("Congress for beginners"), several.join(" / "));
});

test("many sources and long picture credits still fit at a readable size, the rest counted rather than cut", () => {
  const images = Array.from({ length: 9 }, (_, i) => `A photographer with a long name ${i}, a museum's open collection via an archive (CC BY-SA 4.0)`);
  const sources = Array.from({ length: 6 }, (_, i) => ({ title: `A long chapter title from a book on the subject, part ${i + 1}`, quotes: i + 1 }));
  const lines = cardLines({ title: "A title that is long enough to need two or three lines on a phone", sources, images });
  fits(lines);
  assert.ok(lines.some((l) => /^and \d+ more/.test(l.text)), "what does not fit is counted");
  assert.ok(lines.some((l) => l.text.includes("part 1")), "the first source is named");
});

test("the card stays long enough to read, from 5 to 7 s, and the video's length includes it", () => {
  const short = cardSeconds({ title: "Tides", sources: [{ title: "Notes", quotes: 2 }], images: [] });
  const long = cardSeconds({ title: "A title", sources: Array.from({ length: 4 }, (_, i) => ({ title: `Source number ${i} with a longer name`, quotes: 3 })), images: ["Someone, somewhere (CC BY 4.0)", "Someone else, an archive (public domain)"] });
  assert.ok(short >= CARD_SECONDS.least && long <= CARD_SECONDS.most && long > short, `${short} ${long}`);
  const placed = [{ id: "s1", scene: { fps: 30, width: 1080, height: 1920, frames: 90, background: "#fff", nodes: [], tracks: [], events: [] }, theme: { colors: { ink: "#111", paper: "#fff", accent: "#f00" }, fonts: { title: "a", body: "b" }, moveFrames: 10, ease: "linear" }, spoken: { id: "s1", seconds: 3, words: [{ text: "Hello", start: 0.2, end: 0.6 }] } }] as unknown as Placed[];
  const laid = layOut(placed, "flat", { width: 1080, height: 1920 }, [{ title: "Notes", quotes: 1 }, { title: "Notes", quotes: 2 }], [], "Tides");
  const card = laid.timeline.clips.at(-1)!;
  assert.equal(card.type, "credits");
  assert.deepEqual(card.credits!.sources, [{ title: "Notes", quotes: 3 }]);
  assert.equal(laid.timeline.frames, 90 + card.frames);
  assert.ok(card.frames >= CARD_SECONDS.least * 30);
});

test("the card is never a still for more than about 2 s: it rises evenly from its first frame to its last, starting in place and staying in the frame", () => {
  const fps = 30;
  for (const seconds of [CARD_SECONDS.least, CARD_SECONDS.most]) {
    const frames = seconds * fps;
    assert.equal(cardRise(0, frames), 0, "the first frame is in place");
    assert.equal(cardRise(frames - 1, frames), CARD_RISE, "the last frame has risen all the way");
    for (let f = 1; f < frames; f++) assert.ok(cardRise(f, frames) > cardRise(f - 1, frames), `frame ${f} moves`);
    // Over any 2 s, with no music under it, the card has visibly moved.
    for (let f = 0; f + 2 * fps < frames; f++) assert.ok(cardRise(f + 2 * fps, frames) - cardRise(f, frames) >= 5, `still from frame ${f}`);
  }
  // It stays clear of the frame's top edge.
  assert.ok(CARD.top - CARD_RISE >= 60, `${CARD.top - CARD_RISE} px from the top`);
});
