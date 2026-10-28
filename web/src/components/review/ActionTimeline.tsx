import { actionLabel, outcomeLabel, stamp, titleCase } from '../../lib/format';
import type { ActionEntry, Analysis, LocalState } from '../../lib/types';

/** PayPal error names look like "UNPROCESSABLE_ENTITY: ..."; show the name in plain case, never the body. */
export function failureText(a: ActionEntry): string {
  const name = (a.error ?? '').split(':')[0]?.trim() ?? '';
  const why = /^[A-Z][A-Z_]+$/.test(name) ? ` (${titleCase(name)})` : name ? ' (PayPal could not be reached)' : '';
  return `PayPal did not accept ${actionLabel(a.type)}${why}.`;
}

type Item = { key: string; time: string; title: string; text: string };

type Props = {
  actions: ActionEntry[];
  analysis: Analysis | null;
  localState: LocalState;
  outcome: string | null;
};

export function ActionTimeline({ actions, analysis, localState, outcome }: Props) {
  const items: Item[] = [];
  if (localState === 'RESOLVED') {
    items.push({ key: 'resolved', time: '', title: 'Dispute resolved', text: outcomeLabel(outcome) });
  }
  for (const a of actions) {
    if (a.state === 'SENT') {
      items.push({ key: `a${a.id}`, time: stamp(a.sentAt ?? a.createdAt), title: actionLabel(a.type), text: 'Sent to PayPal.' });
    } else if (a.state === 'FAILED') {
      items.push({ key: `a${a.id}`, time: stamp(a.createdAt), title: actionLabel(a.type), text: failureText(a) });
    } else {
      items.push({ key: `a${a.id}`, time: stamp(a.createdAt), title: actionLabel(a.type), text: 'Approved. Waiting to send to PayPal.' });
    }
  }
  if (analysis?.createdAt) {
    const conf = analysis.confidence == null ? '' : `, confidence ${analysis.confidence}`;
    items.push({
      key: 'analysis',
      time: stamp(analysis.createdAt),
      title: 'AI analysis ready',
      text: `Recommended ${actionLabel(analysis.recommendation).toLowerCase()}${conf}.`,
    });
  }

  return (
    <section className="k-card review-card" aria-labelledby="timeline-title">
      <h2 id="timeline-title" className="t-eyebrow eyebrow">
        Timeline
      </h2>
      {items.length === 0 ? (
        <p className="review-empty">Nothing has happened yet. Nothing has been sent to PayPal.</p>
      ) : (
        <ol className="k-tl review-tl">
          {items.map((it, i) => (
            <li key={it.key} className={i === 0 ? 'now' : undefined}>
              {it.time ? <time>{it.time}</time> : null}
              <strong>{it.title}</strong>
              <p>{it.text}</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
