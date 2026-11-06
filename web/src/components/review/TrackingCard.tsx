import type { TrackingShipment } from '../../lib/types';

const SCAN = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  timeZone: 'UTC',
});

function scanTime(iso: string): string {
  const d = new Date(iso);
  // UTC, like the facts list above, so one scan never shows two different times.
  return Number.isNaN(d.getTime()) ? '' : `${SCAN.format(d)} UTC`;
}

function tone(status: string): 'success' | 'warning' | 'secondary' {
  if (status === 'delivered') return 'success';
  if (status === 'delivery_failed') return 'warning';
  return 'secondary';
}

/** Carrier tracking for the order: scan history plus proof of delivery, or proof of non-delivery. */
export function TrackingCard({ tracking }: { tracking: TrackingShipment[] | undefined }) {
  if (!tracking || tracking.length === 0) return null;
  return (
    <section className="k-card review-card" aria-labelledby="tracking-title">
      <h2 id="tracking-title" className="t-eyebrow eyebrow">
        Carrier tracking
      </h2>
      {tracking.map((t) => {
        const events = [...t.events].reverse();
        return (
          <div key={t.trackingNumber || t.shippedAt} className="track-block">
            <div className="review-card__head">
              <span className="track-block__num">{t.trackingNumber}</span>
              <span className={`k-badge k-badge--${tone(t.status)}`}>{t.statusLabel}</span>
            </div>
            {t.status === 'delivered' ? (
              <p className="track-proof">
                <strong>Proof of delivery.</strong> Delivered {scanTime(t.deliveredAt ?? '')}
                {t.signedBy ? `, signed for by ${t.signedBy.toLowerCase().replace(/^recipient/, 'the recipient')}` : ''}.
              </p>
            ) : null}
            {t.status === 'delivery_failed' ? (
              <p className="track-proof track-proof--bad">
                <strong>Not delivered.</strong> The carrier could not locate the package and opened an investigation.
              </p>
            ) : null}
            <ol className="k-tl">
              {events.map((e, i) => (
                <li key={e.status} className={i === 0 ? 'now' : undefined}>
                  <time dateTime={e.occurredAt}>{scanTime(e.occurredAt)}</time>
                  <strong>{e.description}</strong>
                  {e.location ? <p>{e.location}</p> : null}
                </li>
              ))}
            </ol>
            <p className="track-note">
              <a href={`/track/${encodeURIComponent(t.trackingNumber)}`} target="_blank" rel="noreferrer">
                Open the public tracking page
              </a>
              {t.simulated ? ' · Tracking from the sandbox carrier (simulated)' : ''}
            </p>
          </div>
        );
      })}
    </section>
  );
}
