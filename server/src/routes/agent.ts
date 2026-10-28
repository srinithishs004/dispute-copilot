import express, { Router, type RequestHandler } from 'express';
import type { AppDeps } from '../app.js';
import { requireSameOrigin, requireSeller } from '../auth/guards.js';
import { createSignatureStore, runAgentTurn, type AgLlmRequest } from '../ai/chatCompletions.js';
import { LlmUnavailableError } from '../ai/llm.js';

const TURNS_PER_MINUTE = 60;
const WINDOW_MS = 60_000;
const MAX_KEYS = 10_000;
// A widget-agent turn is about 55 KB of JSON; the global parser stops at 100 KB.
const BODY_LIMIT = '512kb';

/** Fixed one-minute window per key. */
function makeTurnLimiter(now: () => number) {
  const hits = new Map<string, { count: number; resetAt: number }>();
  return (key: string): boolean => {
    const t = now();
    const e = hits.get(key);
    if (e && t < e.resetAt) {
      if (e.count >= TURNS_PER_MINUTE) return false;
      e.count += 1;
      return true;
    }
    hits.delete(key);
    if (hits.size >= MAX_KEYS) {
      for (const [k, v] of hits) if (t >= v.resetAt) hits.delete(k);
      // Map iterates in insertion order, so the first keys are the oldest.
      for (const k of hits.keys()) {
        if (hits.size < MAX_KEYS) break;
        hits.delete(k);
      }
    }
    hits.set(key, { count: 1, resetAt: t + WINDOW_MS });
    return true;
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;
const isStr = (x: unknown): x is string => typeof x === 'string';

/** A content part: an object whose `text` and `refusal`, when present, are strings. */
const isPart = (p: unknown): boolean => isObj(p) && isStr(p.type) && (p.text === undefined || isStr(p.text)) && (p.refusal === undefined || isStr(p.refusal));

/** One conversation item, checked by type so the mapper never meets a wrong-typed field. */
function isItem(i: unknown): boolean {
  if (!isObj(i) || !isStr(i.type)) return false;
  switch (i.type) {
    case 'message':
      return isStr(i.content) || (Array.isArray(i.content) && i.content.every(isPart));
    case 'function_call':
      return isStr(i.callId) && isStr(i.name) && isStr(i.arguments);
    case 'function_call_output':
      return isStr(i.callId) && isStr(i.output);
    default:
      return true; // reasoning and unknown items are never sent to a provider
  }
}

const isTurn = (b: unknown): b is AgLlmRequest => {
  if (!isObj(b)) return false;
  return (
    Array.isArray(b.input) &&
    b.input.every(isItem) &&
    (b.instructions === undefined || isStr(b.instructions)) &&
    (b.tools === undefined || Array.isArray(b.tools))
  );
};

/** Model proxy for the AG Studio agent adapter: one non-streamed turn per request. */
export function agentRoutes(deps: AppDeps): Router {
  const { config } = deps;
  const logger = deps.logger ?? console;
  const now = deps.now ?? Date.now;
  const router = Router();
  const allow = makeTurnLimiter(now);
  const signatures = createSignatureStore();

  const limit: RequestHandler = (req, res, next) => {
    const seller = res.locals.seller!;
    const key = res.locals.sellerVia === 'token' ? `ip:${req.ip}` : `email:${seller.email.trim().toLowerCase()}`;
    if (!allow(key)) {
      res.status(429).json({ error: 'analyst busy, try again shortly' });
      return;
    }
    next();
  };

  router.post(
    '/api/agent/turn',
    requireSeller(deps),
    requireSameOrigin(config),
    limit,
    express.json({ limit: BODY_LIMIT }),
    async (req, res) => {
      if (!isTurn(req.body)) {
        res.status(400).json({ error: 'invalid request' });
        return;
      }
      try {
        const { response, reasons } = await runAgentTurn(
          { ...config.llm, fetchImpl: deps.llmFetch, signatures },
          req.body,
        );
        // Reason codes only: never the prompt, tool output or reply.
        if (reasons.length > 0) logger.warn(`agent fallback: ${reasons.join(', ')}`);
        res.json(response);
      } catch (e) {
        if (e instanceof LlmUnavailableError) {
          logger.warn(`agent unavailable: ${e.logDetail}`);
          res.status(503).json({ error: 'analyst unavailable' });
          return;
        }
        throw e;
      }
    },
  );
  return router;
}
