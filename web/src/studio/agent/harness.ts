import { createAiHarness, directLlmRunner } from 'ag-studio';
import type { AgAiHarness, AgAiHarnessSetupParams, AgAiPromptStarter, AgBuiltInAgentId, AgLlmAdapter, AgStudioApi } from 'ag-studio';
import { createProxyAdapter } from './adapter';
import { disputeAnalyst, ANALYST_ID } from './analyst';

/**
 * The dashboard chat: the Dispute Analyst as the primary agent, next to Studio's own data, widget,
 * page and planning agents (unchanged apart from running on our proxy adapter). The analyst hands
 * chart work to the page agent (place) and then the widget agent (configure).
 */

export const BUILT_IN_DELEGATES: readonly AgBuiltInAgentId[] = ['data', 'widget', 'page', 'planning'];

export const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Which disputes are due this week?', prompt: 'Which disputes are due this week?' },
  { label: 'How much money have we kept?', prompt: 'How much money have we kept?' },
  { label: 'Chart outcomes by recommendation', prompt: 'Chart outcomes by recommendation' },
];

export function buildHarness(api: AgStudioApi, adapter: AgLlmAdapter = createProxyAdapter()): AgAiHarness {
  return createAiHarness(api, (ctx) => ({
    agents: [disputeAnalyst(ctx, adapter), ...BUILT_IN_DELEGATES.map((id) => directLlmRunner({ ...ctx.builtIn[id], adapter }))],
    primary: ANALYST_ID,
    promptStarters: PROMPT_STARTERS,
  }));
}

/** What StudioReport's `ai` prop takes. Studio reads it once, when it is created. */
export const analystAi = ({ api }: AgAiHarnessSetupParams): AgAiHarness => buildHarness(api);
