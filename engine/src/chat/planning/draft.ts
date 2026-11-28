/**
 * A plan as the planning skill builds it in memory before anything is
 * written: stages as levels, items with their format, brief, settings,
 * sources, branch and edges. `checkDraft` holds it to the same rules the
 * plan routes and Start hold a plan to; `estimate` prices each item with
 * its format's own `estimateCost`.
 */
import { isRecord } from "../../net";
import type { ConditionRegistry } from "../../studio/conditions";
import { autoLengthMark } from "../../studio/timing";
import { issueMessages, overBudget, validatePlan } from "../../studio/plan-runner";
import type { FormatRegistry } from "../../studio/registry";
import type { PlanEdge, PlanNode, Settings } from "../../studio/repositories";
import type { JsonValue, NodeSource, PicksByScope, SourceLocator } from "../../studio/types";
import { charsIn } from "./sources";

export interface DraftSource {
  sourceId: string;
  range?: SourceLocator;
}

export interface DraftItem {
  /** The stored id for an item that exists, else a key the planner chose. */
  key: string;
  existing: boolean;
  level: number;
  ord: number;
  type: string;
  title: string;
  prompt: string;
  settings: Settings;
  sources: DraftSource[];
  parentKey?: string;
  condition?: JsonValue;
  enabled: boolean;
  estCostUsd?: number;
  /** Set by `estimate` when the format's model has no price. */
  unpriced?: boolean;
}

export interface DraftEdge {
  from: string;
  to: string;
  kind: string;
}

export interface DraftPlan {
  title?: string;
  budgetUsd?: number;
  /** Stage labels by level. */
  labels: Map<number, string>;
  /** The days stages are meant for by level (YYYY-MM-DD), set only when the person gave one. */
  dates?: Map<number, string>;
  items: DraftItem[];
  edges: DraftEdge[];
}

export interface DraftServices {
  registry: FormatRegistry;
  conditions: ConditionRegistry;
  /** Every source of the project, by id: an item may use only these. */
  projectSources: Set<string>;
  /** Source text for estimates; undefined when it is not ready. */
  loadSource(sourceId: string): Promise<NodeSource | undefined>;
  /** Remembered picks by scope (for example a format id), with a reviewer's `off` on its review scope, when known. */
  picks?: PicksByScope;
}

const MAX_TITLE = 200;
const MAX_PROMPT = 20_000;

/**
 * What is wrong with the draft, in words the model can act on. `only`
 * limits the per-item checks (format, settings, sources) to the items the
 * planner wrote or changed; the structure is always checked whole, and
 * `before`, when given, excuses structural problems the plan already had.
 */
export function checkDraft(draft: DraftPlan, services: DraftServices, options: { only?: Set<string>; before?: DraftPlan } = {}): string[] {
  const issues: string[] = [];
  const keys = new Set<string>();
  for (const item of draft.items) {
    if (keys.has(item.key)) issues.push(`two items share the key "${item.key}"`);
    keys.add(item.key);
  }
  if (draft.items.length === 0) issues.push("the plan has no items");
  for (const item of draft.items) {
    if (options.only && !options.only.has(item.key)) continue;
    const name = `item "${item.title || item.key}"`;
    if (!item.title.trim() || item.title.length > MAX_TITLE) issues.push(`${name}: a title of 1 to ${MAX_TITLE} characters is needed`);
    if (item.prompt.length > MAX_PROMPT) issues.push(`${name}: the brief is over ${MAX_PROMPT} characters`);
    const definition = services.registry.get(item.type);
    if (!definition) {
      issues.push(`${name}: "${item.type}" is not a format that can be made now (use one of ${services.registry.ready().join(", ")})`);
    } else {
      const unavailable = services.registry.problem(item.type);
      if (unavailable) issues.push(`${name}: "${item.type}" cannot be made on this computer now (${unavailable}); use one of ${services.registry.ready().join(", ")}`);
      const parsed = definition.parseSettings(item.settings);
      if (!parsed.ok) issues.push(...parsed.issues.map((issue) => `${name}: settings ${issue.path}: ${issue.message}`));
    }
    if (item.sources.length === 0) issues.push(`${name}: it needs at least one source`);
    for (const source of item.sources) {
      if (!services.projectSources.has(source.sourceId)) issues.push(`${name}: source ${source.sourceId} is not in this project`);
    }
  }
  const structural = structure(draft, services.conditions);
  const excused = options.before ? new Set(structure(options.before, services.conditions)) : new Set<string>();
  issues.push(...structural.filter((issue) => !excused.has(issue)));
  issues.push(...issueMessages(overBudget({ ...(draft.budgetUsd !== undefined ? { budgetUsd: draft.budgetUsd } : {}) }, asNodes(draft))));
  return issues;
}

/** The plan runner's structural checks; they name items by title. */
function structure(draft: DraftPlan, conditions: ConditionRegistry): string[] {
  const edges: PlanEdge[] = draft.edges.map((edge) => ({ fromNode: edge.from, toNode: edge.to, kind: edge.kind }));
  return issueMessages(validatePlan(asNodes(draft), edges, conditions));
}

export function asNodes(draft: DraftPlan): PlanNode[] {
  return draft.items.map((item) => ({
    id: item.key,
    planId: "draft",
    level: item.level,
    ord: item.ord,
    type: item.type,
    title: item.title,
    prompt: item.prompt,
    settings: item.settings,
    enabled: item.enabled,
    status: "pending",
    createdAt: "",
    updatedAt: "",
    ...(item.parentKey ? { parentId: item.parentKey } : {}),
    ...(item.condition !== undefined ? { condition: item.condition } : {}),
    ...(item.estCostUsd !== undefined ? { estCostUsd: item.estCostUsd } : {}),
  }));
}

/**
 * Prices the items in `keys` (all when absent) with their format's
 * `estimateCost`, for their settings and the text of their sources. An
 * item whose format has no price, or whose sources are not ready, gets no
 * `estCostUsd`.
 */
export async function estimate(draft: DraftPlan, services: DraftServices, keys?: Set<string>): Promise<void> {
  for (const item of draft.items) {
    if (keys && !keys.has(item.key)) continue;
    const definition = services.registry.get(item.type);
    const parsed = definition?.parseSettings(item.settings);
    if (!definition || !parsed?.ok) continue;
    let sourceChars = 0;
    let missing = false;
    for (const use of item.sources) {
      const source = await services.loadSource(use.sourceId);
      if (!source) missing = true;
      else sourceChars += charsIn(source, use.range);
    }
    const cost = definition.estimateCost({ settings: parsed.settings, sourceChars, sourceCount: item.sources.length });
    delete item.estCostUsd;
    delete item.unpriced;
    if (cost.usd !== undefined && !missing) item.estCostUsd = cost.usd;
    else item.unpriced = true;
  }
}

/** What `settle` decided for one item that left it open. */
export interface Settled {
  key: string;
  title: string;
  /** The settings it decided, by key. */
  values: Record<string, JsonValue>;
}

/**
 * Decides what each item in `keys` (all when absent) leaves open, the way
 * its format would when it is made (`FormatDefinition.settle`): the maker
 * it would get now, that maker's default look, a length from its sources.
 * The planner sets real values; this fills only what it left open, so a
 * plan always says what each item will be. Answers what it decided.
 */
export async function settle(draft: DraftPlan, services: DraftServices, keys?: Set<string>): Promise<Settled[]> {
  const out: Settled[] = [];
  for (const item of draft.items) {
    if (keys && !keys.has(item.key)) continue;
    const definition = services.registry.get(item.type);
    const parsed = definition?.parseSettings(item.settings);
    if (!definition?.settle || !parsed?.ok) continue;
    let sourceChars = 0;
    for (const use of item.sources) {
      const source = await services.loadSource(use.sourceId);
      if (source) sourceChars += charsIn(source, use.range);
    }
    const values = definition.settle(parsed.settings, {
      sourceChars,
      sourceCount: item.sources.length,
      ...(services.picks ? { picks: services.picks } : {}),
    });
    if (Object.keys(values).length === 0) continue;
    // A length left on Auto keeps that fact beside the length filled in, so its time is kept under "auto".
    item.settings = { ...item.settings, ...values, ...autoLengthMark(definition.descriptor, parsed.settings, values) };
    out.push({ key: item.key, title: item.title, values });
  }
  return out;
}

/** The sum of the enabled items' estimates. */
export function totalEstimate(draft: DraftPlan): number {
  return Math.round(draft.items.filter((item) => item.enabled).reduce((sum, item) => sum + (item.estCostUsd ?? 0), 0) * 1_000_000) / 1_000_000;
}

/** Lower snake or camel case, as edge kinds are stored. */
export function edgeKind(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z][a-zA-Z0-9_]{0,39}$/.test(value.trim()) ? value.trim() : undefined;
}

/** A settings object from the model; anything else is no settings. */
export function settingsOf(value: unknown): Settings {
  return isRecord(value) ? (value as Settings) : {};
}
