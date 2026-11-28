/**
 * Turning a planner's answer into a stored plan, shared by everything that
 * plans: the planning skill (one model call, repaired in rounds) and the
 * agent's plan tools (the person's own agent, repaired by calling again).
 * Both hand over the same JSON shapes (prompts.ts) and get the same checks:
 * read, priced by each format, held to the plan model's rules, and written
 * only when nothing is wrong.
 */
import type { ConditionRegistry } from "../../studio/conditions";
import type { FormatRegistry } from "../../studio/registry";
import type { Plan, Source, StudioRepositories } from "../../studio/repositories";
import type { NodeSource, PicksByScope } from "../../studio/types";
import type { TurnSource } from "../context";
import { checkDraft, estimate, settle, type DraftPlan, type DraftServices, type Settled } from "./draft";
import { applyOps, readPlan, type HandItems, type PlanSnapshot } from "./edit";
import { readNewPlan } from "./read";
import type { SourceMap } from "./sources";
import { writeEdit, writeNewPlan } from "./write";

export interface PlanWriter {
  repos: StudioRepositories;
  registry: FormatRegistry;
  owner: { ownerId: string; projectId: string; sessionId: string };
}

/** A new plan from the planner's JSON, or every problem it has (nothing is written then). */
export async function commitNewPlan(raw: unknown, map: SourceMap, services: DraftServices, writer: PlanWriter): Promise<{ plan: Plan; reply: string; settled: Settled[] } | { issues: string[] }> {
  const read = readNewPlan(raw, map);
  // What the planner left open is decided before it is priced, so the plan says what each item will be.
  const settled = await settle(read.draft, services);
  // Every problem at once, so one round can fix them all.
  await estimate(read.draft, services);
  const issues = [...read.issues, ...checkDraft(read.draft, services)];
  if (issues.length > 0) return { issues };
  const plan = await writeNewPlan(writer.repos, writer.registry, writer.owner, read.draft);
  return { plan, reply: read.reply, settled };
}

export type EditOutcome =
  | { changes: string[]; kept: string[]; settled: Settled[] }
  | { issues: string[] }
  /** The plan was started or closed while the change was being worked out. */
  | { closed: string };

/**
 * Applies the planner's ops to the plan as it is now (`shown` is what the
 * planner was shown), or returns every problem they have.
 */
export async function commitEdit(
  raw: unknown,
  plan: Plan,
  shown: PlanSnapshot,
  map: SourceMap,
  services: DraftServices,
  writer: Pick<PlanWriter, "repos" | "registry">,
  hand?: HandItems,
): Promise<EditOutcome> {
  const { repos } = writer;
  const fresh = await repos.plans.get(plan.id);
  if (!fresh || fresh.kickedOffAt || fresh.status === "discarded") {
    return { closed: `"${plan.title ?? "The plan"}" was ${fresh?.kickedOffAt ? "started" : "closed"} while I was working, so I changed nothing.` };
  }
  const current = await readPlan(repos, fresh);
  const applied = applyOps(raw, shown, current, map, hand);
  const settled = await settle(applied.draft, services, applied.touched);
  await estimate(applied.draft, services, applied.touched);
  const issues = [...applied.issues, ...checkDraft(applied.draft, services, { only: applied.touched, before: current.draft })];
  if (issues.length > 0) return { issues };
  await writeEdit(repos, writer.registry, fresh, current.draft, applied.draft);
  return { changes: applied.changes, kept: applied.kept, settled };
}

export type AppendOutcome = { added: number; stages: number; settled: Settled[] } | { issues: string[] } | { closed: string };

/**
 * Adds stages at the end of a plan that has not started, in the shape a
 * new plan is written in: how a plan too big for one call is written in
 * parts. The new items may link to the plan's items by the refs the
 * planner was shown (I1, I2, ...). Checked whole, like a new plan; nothing
 * is written while it has problems.
 */
export async function commitAppend(raw: unknown, plan: Plan, map: SourceMap, services: DraftServices, writer: Pick<PlanWriter, "repos" | "registry">): Promise<AppendOutcome> {
  const { repos } = writer;
  const fresh = await repos.plans.get(plan.id);
  if (!fresh || fresh.kickedOffAt || fresh.status === "discarded") {
    return { closed: `"${plan.title ?? "The plan"}" ${fresh?.kickedOffAt ? "has started" : "is closed"}, so nothing can be added to it.` };
  }
  const current = await readPlan(repos, fresh);
  const lastLevel = Math.max(0, ...current.draft.items.map((item) => item.level));
  const read = readNewPlan(raw, map, { lastLevel, refs: current.itemRefs });
  const taken = new Set(current.draft.items.map((item) => item.key));
  const clashes = read.draft.items.filter((item) => taken.has(item.key)).map((item) => `item "${item.title || item.key}": its key "${item.key}" is taken; pick a new one`);
  const added = new Set(read.draft.items.map((item) => item.key));
  const merged: DraftPlan = {
    ...current.draft,
    labels: new Map([...current.draft.labels, ...read.draft.labels]),
    dates: new Map([...(current.draft.dates ?? []), ...(read.draft.dates ?? [])]),
    items: [...current.draft.items.map((item) => ({ ...item, sources: [...item.sources] })), ...read.draft.items],
    edges: [...current.draft.edges, ...read.draft.edges],
  };
  const settled = await settle(merged, services, added);
  await estimate(merged, services, added);
  const issues = [...read.issues, ...clashes, ...checkDraft(merged, services, { only: added, before: current.draft })];
  if (issues.length > 0) return { issues };
  await writeEdit(repos, writer.registry, fresh, current.draft, merged);
  return { added: added.size, stages: new Set(read.draft.items.map((item) => item.level)).size, settled };
}

/** Remembered picks by scope for this owner, with a reviewer's `off` on its review scope; undefined when none are saved. */
export async function picksByScope(
  repos: StudioRepositories,
  ownerId: string,
): Promise<PicksByScope | undefined> {
  const list = await repos.providerSettings.listPicks(ownerId);
  if (list.length === 0) return undefined;
  const picks: PicksByScope = {};
  for (const p of list) {
    picks[p.scope] = {
      ...(p.agent ? { agent: p.agent } : {}),
      ...(p.model ? { model: p.model } : {}),
      ...(p.effort ? { effort: p.effort } : {}),
      ...(p.off ? { off: p.off } : {}),
    };
  }
  return picks;
}

/** What checking and pricing a draft reads: the formats, conditions and the project's sources. */
export function draftServicesFor(input: {
  repos: StudioRepositories;
  registry: FormatRegistry;
  conditions: ConditionRegistry;
  projectSources: Source[];
  /** Sources already read this turn. */
  sources: TurnSource[];
  picks?: PicksByScope;
}): DraftServices {
  const { repos } = input;
  const loaded = new Map<string, NodeSource | undefined>(input.sources.map((source) => [source.sourceId, { ...source, range: undefined }]));
  return {
    registry: input.registry,
    conditions: input.conditions,
    projectSources: new Set(input.projectSources.map((source) => source.id)),
    ...(input.picks ? { picks: input.picks } : {}),
    async loadSource(sourceId) {
      if (loaded.has(sourceId)) return loaded.get(sourceId);
      const source = input.projectSources.find((candidate) => candidate.id === sourceId);
      const extraction = source ? await repos.sources.getExtraction(source.contentHash) : undefined;
      const value =
        source && extraction?.status === "ready" && extraction.envelope
          ? { sourceId, title: source.title, envelope: extraction.envelope, chunks: await repos.sources.listChunks(source.contentHash) }
          : undefined;
      loaded.set(sourceId, value);
      return value;
    },
  };
}
