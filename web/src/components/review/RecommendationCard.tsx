import { actionLabel, money, shortDate } from '../../lib/format';
import type { Analysis, LocalState } from '../../lib/types';
import { AlertIcon } from '../Icons';

const STRENGTH: Record<string, { label: string; tone: string }> = {
  STRONG: { label: 'Strong evidence', tone: 'k-badge--success' },
  MEDIUM: { label: 'Medium evidence', tone: 'k-badge--info' },
  WEAK: { label: 'Weak evidence', tone: 'k-badge--warning' },
};

type Props = {
  analysis: Analysis | null;
  localState: LocalState;
  amount: string | null;
  currency: string | null;
};

export function RecommendationCard({ analysis, localState, amount, currency }: Props) {
  const analyzing = localState === 'ANALYZING' || localState === 'NEW';
  const strength = analysis?.evidenceStrength ? STRENGTH[analysis.evidenceStrength] : undefined;
  const confidence = analysis?.confidence == null ? null : Math.max(0, Math.min(100, Math.round(analysis.confidence)));

  return (
    <section className="k-card review-card rec" aria-labelledby="rec-title">
      <h2 id="rec-title" className="t-eyebrow eyebrow">
        AI recommendation
      </h2>

      {analyzing ? (
        <div className="rec__reading" aria-live="polite">
          <span className="rec__pulse" aria-hidden="true" />
          <p>The AI is reading the evidence</p>
        </div>
      ) : null}

      {!analysis && analyzing ? (
        <div className="rec__skel" aria-hidden="true">
          <div className="k-skel rec__skel-word" />
          <div className="k-skel rec__skel-line" />
          <div className="k-skel rec__skel-line rec__skel-line--short" />
        </div>
      ) : null}

      {!analysis && !analyzing ? (
        <div className="rec__none">
          <p className="rec__word rec__word--muted">No recommendation</p>
          <p className="muted">Pick the action yourself and write the letter. The evidence on the right still applies.</p>
        </div>
      ) : null}

      {analysis ? (
        <>
          <p className="rec__word">{actionLabel(analysis.recommendation)}</p>

          <div className="rec__stats">
            {confidence !== null ? (
              <div className="rec__stat">
                <span className="rec__label">Confidence</span>
                <span className="rec__num">
                  <span>{confidence}</span>
                  <span className="rec__of">/ 100</span>
                </span>
                <div className="k-progress rec__bar" aria-hidden="true">
                  <span style={{ width: `${confidence}%` }} />
                </div>
              </div>
            ) : null}
            {strength ? (
              <div className="rec__stat">
                <span className="rec__label">Evidence</span>
                <span className={`k-badge ${strength.tone}`}>{strength.label}</span>
              </div>
            ) : null}
            {analysis.suggestedOffer ? (
              <div className="rec__stat">
                <span className="rec__label">Suggested offer</span>
                <span className="rec__num">
                  <span>{money(analysis.suggestedOffer, currency)}</span>
                  {amount ? <span className="rec__of">of {money(amount, currency)}</span> : null}
                </span>
              </div>
            ) : null}
          </div>

          {analysis.reasons.length > 0 ? (
            <div className="rec__block">
              <h3 className="rec__label">Why</h3>
              <ul className="rec__reasons">
                {analysis.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          ) : null}

          {analysis.flags.length > 0 ? (
            <div className="k-alert k-alert--warning rec__flags">
              <span className="k-alert__icon" aria-hidden="true">
                <AlertIcon size={14} />
              </span>
              <div>
                <strong>Safety checks changed this advice</strong>
                {analysis.flags.map((f, i) => (
                  <span key={i} className="rec__flag">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          ) : null}

          {analysis.createdAt || analysis.modelUsed ? (
            <p className="rec__meta">
              {analysis.createdAt ? `Analyzed ${shortDate(analysis.createdAt)}` : null}
              {analysis.createdAt && analysis.modelUsed ? ' · ' : null}
              {analysis.modelUsed ?? null}
            </p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
