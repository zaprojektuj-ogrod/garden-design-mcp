// Design knowledge cards: a graph the agent reads by its parts. Hubs gather cards (`contains`); cards lead to others
// (`uses`), and some are rivals (`alternative_to`, `conflicts_with`): once a style or approach is picked, its part of
// the graph is the knowledge applied and its rivals drop out. Node only (reads a folder): served by server.ts, never
// bundled into the in-app agent.

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

export interface Card {
  id: string; type: string; stage: string[]; set: string; useWhen: string;
  links: Record<string, string[]>; body: string;
}

// Flow list "[a, "b, c", d]" → ['a', 'b, c', 'd']
function list(s: string): string[] {
  const inner = s.trim().replace(/^\[|\]$/g, "");
  const out: string[] = []; let cur = ""; let q = false;
  for (const ch of inner) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) { if (cur.trim()) out.push(cur.trim()); cur = ""; }
    else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * One card file → a card, or null when it isn't served: no frontmatter, private, retired, or held out (`hold:`).
 * The frontmatter subset the library uses: "key: value", "key: [..]", and "key:" with indented "sub: [..]"
 */
export function parseCard(text: string): Card | null {
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!m) return null;
  const meta: Record<string, string | string[] | Record<string, string[]>> = {};
  let parent: string | null = null;
  for (const line of m[1].split(/\r?\n/)) {
    const sub = line.match(/^\s+(\w+):\s*(.*)$/);
    const top = line.match(/^(\w+):\s*(.*)$/);
    if (sub && parent) (meta[parent] as Record<string, string[]>)[sub[1]] = list(sub[2]);
    else if (top) {
      const [, k, v] = top;
      if (v === "") { meta[k] = {}; parent = k; } else { meta[k] = v.startsWith("[") ? list(v) : v; parent = null; }
    }
  }
  if (meta.tier !== "open" || meta.status === "retired" || meta.hold !== undefined) return null;
  if (typeof meta.id !== "string" || typeof meta.type !== "string") return null;
  return {
    id: meta.id, type: meta.type, stage: Array.isArray(meta.stage) ? meta.stage : [],
    set: typeof meta.set === "string" ? meta.set : "", useWhen: typeof meta.use_when === "string" ? meta.use_when : "",
    links: (meta.links && !Array.isArray(meta.links) && typeof meta.links === "object" ? meta.links : {}) as Record<string, string[]>,
    body: m[2].trim(),
  };
}

/** The served cards of a library folder (its `cards/` subfolder, or the folder itself) */
export function loadCards(dir: string): Map<string, Card> {
  const folder = existsSync(join(dir, "cards")) ? join(dir, "cards") : dir;
  const cards = new Map<string, Card>();
  for (const f of readdirSync(folder).filter((f) => f.endsWith(".md"))) {
    const c = parseCard(readFileSync(join(folder, f), "utf8"));
    if (c) cards.set(c.id, c);
  }
  // links to cards not served (private, held) are dropped, so the graph only leads to what can be read
  for (const c of cards.values()) for (const k of Object.keys(c.links)) c.links[k] = c.links[k].filter((id) => cards.has(id));
  return cards;
}

/** Cards each card is a rival of, both ways round; an anti-pattern is a warning, never a rival */
function rivals(cards: Map<string, Card>): Map<string, Set<string>> {
  const r = new Map<string, Set<string>>();
  const add = (a: string, b: string) => { if (!r.has(a)) r.set(a, new Set()); r.get(a)!.add(b); };
  for (const c of cards.values()) {
    for (const t of [...(c.links.alternative_to ?? []), ...(c.links.conflicts_with ?? [])]) {
      if (c.type === "anti-pattern" || cards.get(t)?.type === "anti-pattern") continue;
      add(c.id, t); add(t, c.id);
    }
  }
  return r;
}

const line = (c: Card) => `${c.id} (${c.type}) — ${c.useWhen}`;

/** Where to start: the hubs, and the choices the graph holds (each pair of rival cards once) */
export function cardMap(cards: Map<string, Card>) {
  const hubs = [...cards.values()].filter((c) => c.type === "hub")
    .map((c) => ({ id: c.id, stage: c.stage, set: c.set || null, cards: (c.links.contains ?? []).length, useWhen: c.useWhen }));
  const choices: string[] = [];
  for (const [a, rs] of [...rivals(cards)].sort(([x], [y]) => x.localeCompare(y)))
    for (const b of [...rs].sort()) if (a < b) choices.push(`${a} | ${b}`);
  return { hubs, choices };
}

/**
 * The part of the graph the picks lead to: the picked cards, then every card reached from them by `contains` and
 * `uses`, never through or into a rival of a picked card. Returned as an index, one line a card; a card with rivals
 * still in the part names them — a choice left to make
 */
export function pickedPart(cards: Map<string, Card>, picks: string[]) {
  const unknown = picks.filter((id) => !cards.has(id));
  const r = rivals(cards);
  const out = new Set<string>();
  for (const p of picks) for (const x of r.get(p) ?? []) if (!picks.includes(x)) out.add(x);
  const part: string[] = [], todo = picks.filter((id) => cards.has(id)).reverse();
  const seen = new Set<string>();
  while (todo.length) {
    const id = todo.pop()!;
    if (seen.has(id) || out.has(id)) continue;
    seen.add(id); part.push(id);
    const c = cards.get(id)!;
    todo.push(...[...(c.links.contains ?? []), ...(c.links.uses ?? [])].reverse());
  }
  const inPart = new Set(part);
  const index = part.map((id) => {
    const open = [...(r.get(id) ?? [])].filter((x) => inPart.has(x));
    return line(cards.get(id)!) + (open.length ? ` [or: ${open.join(", ")}]` : "");
  });
  return { picked: picks.filter((id) => cards.has(id)), dropped: [...out].sort(), cards: index.length, index, ...(unknown.length ? { unknown } : {}) };
}

/** Whole cards by id */
export function fullCards(cards: Map<string, Card>, ids: string[]) {
  return ids.map((id) => {
    const c = cards.get(id);
    return c ? `## ${c.id} (${c.type})\nUse when: ${c.useWhen}\n\n${c.body.replace(/^## /gm, "### ")}` : `## ${id}\nNo such card.`;
  }).join("\n\n---\n\n");
}

/** `n` cards drawn at random from the picked part, leaving out the picks and those named in `exclude` */
export function drawCards(cards: Map<string, Card>, picks: string[], n: number, exclude: string[] = [], random = Math.random) {
  const pool = pickedPart(cards, picks).index.map((l) => l.split(" ")[0])
    .filter((id) => !picks.includes(id) && !exclude.includes(id) && cards.get(id)?.type !== "hub");
  const drawn: string[] = [];
  while (drawn.length < n && pool.length) drawn.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return drawn;
}

export const DESIGN_CARDS_TOOL = {
  name: "design_cards",
  description:
    "Design knowledge: a graph of short cards (a rule, a pattern, a style, a warning), each with when to use it and a check you can run on the plan. " +
    "Some cards are rivals — two styles, two ways of solving one thing — so you never apply them all: pick, and the picked part of the graph is the knowledge you apply. " +
    "Call with no arguments for the map (the hubs, and the choices the graph holds). After the style questions, `pick` the hub for the step and the cards that match the user's answers: " +
    "you get that part of the graph as an index (one line a card; `[or: …]` marks a choice still open), and the rivals of your picks are dropped. " +
    "Read the cards you need in full with `ids`. `draw` gives that many cards at random from the picked part, for ideas you would not have looked for (pass the same `pick`; `exclude` what you have read). " +
    "Write your picks in the journal, so a later session picks the same. When a card shapes a zone, put its id in that zone's notes.",
  inputSchema: {
    type: "object" as const,
    properties: {
      pick: { type: "array", items: { type: "string" }, description: "Hub and card ids: the part of the graph to apply" },
      ids: { type: "array", items: { type: "string" }, description: "Cards to read in full" },
      draw: { type: "number", description: "Cards to draw at random from the picked part (with `pick`)" },
      exclude: { type: "array", items: { type: "string" }, description: "Cards left out of the draw (those already read)" },
    },
  },
};

/** The tool's answer for one call */
export function designCards(cards: Map<string, Card>, args: { pick?: string[]; ids?: string[]; draw?: number; exclude?: string[] }) {
  const pick = args.pick ?? [];
  if (args.ids?.length) return fullCards(cards, args.ids);
  if (args.draw && pick.length) return fullCards(cards, drawCards(cards, pick, Math.min(5, Math.max(1, Math.round(args.draw))), args.exclude));
  if (pick.length) return JSON.stringify(pickedPart(cards, pick));
  return JSON.stringify(cardMap(cards));
}
