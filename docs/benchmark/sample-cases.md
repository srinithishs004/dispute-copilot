# Sample-case benchmark

Date: 2026-11-06 · Script: `server/scripts/benchmark.ts` · No AI calls, no network.

Run it from the repo root after `npm ci`:

```
npx tsx server/scripts/benchmark.ts
```

It loads the 12 seeded store orders into an in-memory database, builds the evidence pack for each with the same code the app uses (`buildEvidencePack`), then feeds an over-confident "FIGHT, strong evidence" recommendation through the advisor guardrails (`applyGuardrails`) to see how often the guardrail stops it.

## Results

| Order | Item | Claim | Evidence present | Missing | Facts gathered | Naive FIGHT blocked |
|---|---|---|---|---|---|---|
| DEMO-HIST-01 | Ceramic Mug | Not received | 2/3 | signature on delivery | 11 | yes |
| DEMO-HIST-02 | Desk Lamp | Not received | 3/3 | none | 12 | no |
| DEMO-HIST-03 | Logo T-Shirt | Not received | 2/3 | signature on delivery | 11 | yes |
| DEMO-HIST-04 | Leather Wallet | Not received | 3/3 | none | 12 | no |
| DEMO-HIST-05 | Wool Throw Blanket | Not received | 1/3 | delivery confirmation, signature on delivery | 10 | yes |
| DEMO-HIST-06 | Ceramic Mug | Not received | 1/3 | delivery confirmation, signature on delivery | 10 | yes |
| DEMO-HIST-07 | Desk Lamp | Not received | 0/3 | tracking number, delivery confirmation, signature on delivery | 6 | yes |
| DEMO-HIST-08 | Linen Tote Bag | Not as described | 3/3 | none | 13 | no |
| DEMO-HIST-09 | Logo T-Shirt | Not as described | 3/3 | none | 13 | no |
| DEMO-HIST-10 | Ceramic Mug Set | Not as described | 3/3 | none | 12 | no |
| DEMO-HIST-11 | Desk Lamp | Not received | 2/3 | signature on delivery | 12 | yes |
| DEMO-HIST-12 | Noise-Cancelling Headphones | Not received | 3/3 | none | 13 | no |

- 12 cases, 135 facts assembled automatically (about 11 per case).
- 26 of 36 required evidence items found automatically (72%); 6 of 12 packs complete.
- In 6 of 12 cases required evidence is missing, so an over-confident FIGHT would have been sent on a weak case. The guardrail turns each into an OFFER and lists exactly what is missing.

## What this does and does not show

- The buyer claim for each order (not received or not as described) is an assumption chosen to fit the seeded data.
- It measures evidence completeness and the guardrail, not the quality of the AI's judgement and not real win rates.
- It does not measure time saved or deadlines met against a manual process: there is no recorded manual baseline, so no such claim is made.
