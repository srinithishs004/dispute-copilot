import { describe, expect, it, vi } from 'vitest';
import type { AgAiHarnessBuilderContext, AgAiHarnessConfig, AgLlmAdapter, AgStudioApi } from 'ag-studio';

// The real ag-studio is about 5.8 MB and needs a live Studio; the harness wiring is tested against stand-ins.
const created: { api: unknown; build: ((ctx: AgAiHarnessBuilderContext) => AgAiHarnessConfig) | null } = { api: null, build: null };
vi.mock('ag-studio', () => ({
  createAiHarness: (api: unknown, build: (ctx: AgAiHarnessBuilderContext) => AgAiHarnessConfig) => {
    created.api = api;
    created.build = build;
    return { kind: 'harness' };
  },
  directLlmRunner: (def: Record<string, unknown>) => ({ ...def, run: 'direct' }),
}));

import { ANALYST_ID, ANALYST_INSTRUCTIONS, ANALYST_MAX_TURNS, disputeAnalyst } from './analyst';
import { BUILT_IN_DELEGATES, PROMPT_STARTERS, analystAi, buildHarness } from './harness';

const tool = (name: string) => ({ name });
function fakeCtx() {
  const delegateTo = vi.fn((ids: readonly string[]) => ({ name: 'delegate_to', ids }));
  const builtIn = Object.fromEntries(
    ['lead', 'data', 'page', 'planning', 'widget'].map((id) => [id, { id, name: `${id} agent`, instructions: () => `${id} prompt` }]),
  );
  const studio = { viewSchema: vi.fn(() => tool('view_schema')), executeQuery: vi.fn(() => tool('execute_query')) };
  const ctx = { tools: { delegateTo, studio, renameThread: vi.fn(), plan: {} }, builtIn } as unknown as AgAiHarnessBuilderContext;
  return { ctx, delegateTo, studio };
}
const adapter: AgLlmAdapter = { executeTurn: vi.fn() as unknown as AgLlmAdapter['executeTurn'] };

describe('disputeAnalyst', () => {
  it('is the read-only Dispute Analyst with a 12 turn budget', () => {
    const { ctx } = fakeCtx();
    const a = disputeAnalyst(ctx, adapter);
    expect(a.id).toBe('dispute-analyst');
    expect(ANALYST_ID).toBe('dispute-analyst');
    expect(a.name).toBe('Dispute Analyst');
    expect(a.maxTurns).toBe(12);
    expect(ANALYST_MAX_TURNS).toBe(12);
    expect((a as unknown as { adapter: unknown }).adapter).toBe(adapter);
    expect(a.instructions?.({} as never, undefined)).toBe(ANALYST_INSTRUCTIONS);
  });

  it('lists view_schema, execute_query and delegate_to data, page and widget, and nothing that acts', () => {
    const { ctx, delegateTo, studio } = fakeCtx();
    const tools = disputeAnalyst(ctx, adapter).tools?.({} as never, undefined) ?? [];
    expect(tools.map((t) => t.name)).toEqual(['view_schema', 'execute_query', 'delegate_to']);
    expect(studio.viewSchema).toHaveBeenCalled();
    expect(studio.executeQuery).toHaveBeenCalled();
    expect(delegateTo).toHaveBeenCalledWith(['data', 'page', 'widget']);
  });

  it('instructions keep it to the data, never advise approving, and delegate charts page then widget', () => {
    const t = ANALYST_INSTRUCTIONS;
    for (const s of ['disputes', 'actions', 'evidence_gaps', 'execute_query', 'view_schema']) expect(t).toContain(s);
    for (const f of [
      'disputes.amountKept',
      'disputes.amountRefunded',
      'disputes.deadline',
      'disputes.daysLeft',
      'disputes.recommendation',
      'disputes.confidence',
      'disputes.evidenceStrength',
      'disputes.outcome',
    ])
      expect(t).toContain(f);
    expect(t).toMatch(/never (invent|guess)/i);
    expect(t).toMatch(/cannot act on PayPal/i);
    expect(t).toMatch(/never (tell|advise)[^.]*approv/i);
    expect(t).toContain('/disputes/');
    expect(t).toMatch(/delegate_to page[\s\S]*then delegate_to widget/);
    // Each turn already sends about 55 KB of tool schemas; keep the prompt itself small.
    expect(t.length).toBeLessThan(3200);
    expect(t).not.toMatch(/[\u2013\u2014]/);
  });
});

describe('buildHarness', () => {
  it('makes dispute-analyst primary, wraps the built-in agents on the same adapter, and offers the three starters', () => {
    const api = { name: 'api' } as unknown as AgStudioApi;
    expect(buildHarness(api, adapter)).toEqual({ kind: 'harness' });
    expect(created.api).toBe(api);
    const { ctx } = fakeCtx();
    const config = created.build!(ctx);
    expect(config.primary).toBe('dispute-analyst');
    expect(config.agents.map((a) => a.id)).toEqual(['dispute-analyst', 'data', 'widget', 'page', 'planning']);
    expect(BUILT_IN_DELEGATES).toEqual(['data', 'widget', 'page', 'planning']);
    for (const a of config.agents.slice(1)) {
      expect((a as unknown as { adapter: unknown }).adapter).toBe(adapter);
      expect(a.maxTurns).toBeUndefined(); // built-ins keep their defaults
      expect(a.instructions?.({} as never, undefined)).toBe(`${a.id} prompt`);
    }
    expect(config.promptStarters?.map((p) => p.label)).toEqual([
      'Which disputes are due this week?',
      'How much money have we kept?',
      'Chart outcomes by recommendation',
    ]);
    expect(config.promptStarters).toEqual(PROMPT_STARTERS);
    for (const p of PROMPT_STARTERS) expect(p.prompt.length).toBeGreaterThan(0);
  });

  it('analystAi builds from the api Studio passes in', () => {
    const api = { name: 'api2' } as unknown as AgStudioApi;
    analystAi({ api } as never);
    expect(created.api).toBe(api);
  });
});
