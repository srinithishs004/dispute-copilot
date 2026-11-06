import { sentence, titleCase } from '../../lib/format';
import type { EvidencePack, Fact } from '../../lib/types';
import { SquareCheckIcon, SquareMinusIcon } from '../Icons';

/** Store values like "in_transit" read as "In transit". */
function factValue(f: Fact): string {
  if (f.id.endsWith('.status') && /^[a-z_]+$/.test(f.value)) return sentence(titleCase(f.value).toLowerCase());
  return f.value;
}

export function EvidenceChecklist({ evidence }: { evidence: EvidencePack | null }) {
  if (!evidence) {
    return (
      <section className="k-card review-card" aria-labelledby="evidence-title">
        <h2 id="evidence-title" className="t-eyebrow eyebrow">
          Evidence
        </h2>
        <p className="review-empty">No store order matched this dispute, so there is no evidence on file.</p>
      </section>
    );
  }
  // A parcel the carrier lost cannot have a delivery scan or a signature, so those rows are not gaps.
  const lost = Boolean(evidence.carrierException);
  const notApplicable = (c: { requirement: string; present: boolean }) =>
    lost && !c.present && /deliver|signature/i.test(c.requirement);
  const applicable = evidence.checklist.filter((c) => !notApplicable(c));
  const present = applicable.filter((c) => c.present).length;
  return (
    <>
      <section className="k-card review-card" aria-labelledby="evidence-title">
        <div className="review-card__head">
          <h2 id="evidence-title" className="t-eyebrow eyebrow">
            Evidence
          </h2>
          <span className="review-card__count">
            {present} of {applicable.length} on file
          </span>
        </div>
        <ul className="checklist">
          {evidence.checklist.map((c) => (
            <li
              key={c.requirement}
              className={c.present ? 'checklist__item is-present' : 'checklist__item is-missing'}
              title={notApplicable(c) ? 'The carrier reports this parcel as lost, so there is no delivery to confirm.' : undefined}
            >
              {c.present ? <SquareCheckIcon size={18} /> : <SquareMinusIcon size={18} />}
              <span className="checklist__name">{sentence(c.requirement)}</span>
              <span className="checklist__state">{c.present ? 'On file' : notApplicable(c) ? 'Not applicable: parcel lost' : 'Missing'}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="k-card review-card" aria-labelledby="facts-title">
        <h2 id="facts-title" className="t-eyebrow eyebrow">
          Facts the AI used
        </h2>
        {evidence.facts.length === 0 ? (
          <p className="review-empty">No facts on file.</p>
        ) : (
          <dl className="facts">
            {evidence.facts.map((f) => (
              <div key={f.id} className="facts__row">
                <dt>{f.label}</dt>
                <dd>{factValue(f)}</dd>
              </div>
            ))}
          </dl>
        )}
      </section>
    </>
  );
}
