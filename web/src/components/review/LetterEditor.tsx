import { useId, type RefObject } from 'react';
import { ACTION_SHORT, actionLabel } from '../../lib/format';
import type { DisputeAction } from '../../lib/types';
import { ShieldIcon } from '../Icons';

export const NOTE_MIN = 20;
export const NOTE_MAX = 2000;

export type FieldErrors = { note?: string; offer?: string };

type Props = {
  allowed: DisputeAction[];
  recommended: DisputeAction | null;
  action: DisputeAction | null;
  onAction(a: DisputeAction): void;
  offer: string;
  onOffer(v: string): void;
  note: string;
  onNote(v: string): void;
  currency: string | null;
  errors: FieldErrors;
  /** Whole area read-only (ANALYZING). */
  disabled: boolean;
  disabledReason: string | null;
  stale: boolean;
  onReloadLetter(): void;
  onApprove(): void;
  approveRef: RefObject<HTMLButtonElement>;
  noteRef: RefObject<HTMLTextAreaElement>;
  offerRef: RefObject<HTMLInputElement>;
};

/** The action picker, the offer amount, the letter and the page's single primary button. */
export function LetterEditor(p: Props) {
  const ids = { picker: useId(), offer: useId(), offerHelp: useId(), note: useId(), noteHelp: useId() };
  const len = p.note.length;
  const trimmed = p.note.trim().length;
  const outOfRange = len > 0 && (trimmed < NOTE_MIN || trimmed > NOTE_MAX);
  const noActions = p.allowed.length === 0;
  const off = p.disabled || noActions;

  return (
    <section className="k-card review-card approve" aria-labelledby="approve-title">
      <h2 id="approve-title" className="t-eyebrow eyebrow">
        Your response
      </h2>
      <p className="approve__safe">
        <ShieldIcon size={16} />
        Nothing is sent to PayPal until you approve.
      </p>

      {p.disabledReason ? <p className="approve__why">{p.disabledReason}</p> : null}

      <fieldset className="approve__fields" disabled={off}>
        {noActions ? null : (
          <div className="approve__picker">
            <span id={ids.picker} className="k-label">
              Action
            </span>
            <div className="k-seg approve__seg" role="group" aria-labelledby={ids.picker}>
              {p.allowed.map((a) => (
                <button
                  key={a}
                  type="button"
                  aria-pressed={!p.disabled && p.action === a}
                  onClick={() => p.onAction(a)}
                >
                  {ACTION_SHORT[a]}
                  {p.recommended === a && !p.disabled ? <span className="approve__ai">AI pick</span> : null}
                </button>
              ))}
            </div>
            {p.action && !p.disabled ? <span className="k-help">You are about to: {actionLabel(p.action).toLowerCase()}.</span> : null}
          </div>
        )}

        {p.action === 'OFFER' ? (
          <div className="k-field approve__offer">
            <label className="k-label" htmlFor={ids.offer}>
              Offer amount
            </label>
            <div className="money-input">
              <input
                ref={p.offerRef}
                id={ids.offer}
                className={`k-input money-input__field${p.errors.offer ? ' k-input--error' : ''}`}
                inputMode="decimal"
                autoComplete="off"
                value={p.offer}
                onChange={(e) => p.onOffer(e.target.value)}
                aria-invalid={p.errors.offer ? true : undefined}
                aria-describedby={ids.offerHelp}
              />
              {p.currency ? <span className="money-input__cur">{p.currency}</span> : null}
            </div>
            <span id={ids.offerHelp} className={p.errors.offer ? 'k-help k-help--error' : 'k-help'}>
              {p.errors.offer ?? 'Partial refund offered to the buyer.'}
            </span>
          </div>
        ) : null}

        <div className="k-field approve__letter">
          <label className="k-label" htmlFor={ids.note}>
            Letter
          </label>
          {p.stale ? (
            <div className="k-alert k-alert--info approve__stale" role="status">
              <span className="k-alert__icon" aria-hidden="true">
                i
              </span>
              <div>
                <span>The analysis was updated.</span>
              </div>
              <button type="button" className="k-btn k-btn--sm k-btn--ghost" onClick={p.onReloadLetter}>
                Reload the letter
              </button>
            </div>
          ) : null}
          <textarea
            ref={p.noteRef}
            id={ids.note}
            className={`k-input approve__textarea${p.errors.note ? ' k-input--error' : ''}`}
            value={p.note}
            onChange={(e) => p.onNote(e.target.value)}
            rows={12}
            placeholder="Write to the buyer and PayPal. Stick to facts from the evidence."
            aria-invalid={p.errors.note ? true : undefined}
            aria-describedby={ids.noteHelp}
          />
          <div className="approve__help">
            <span id={ids.noteHelp} className={p.errors.note ? 'k-help k-help--error' : 'k-help'}>
              {p.errors.note ?? 'Sent to PayPal with your response. 20 to 2000 characters.'}
            </span>
            <span className={`approve__count${outOfRange ? ' is-bad' : ''}`}>
              {len} / {NOTE_MAX}
            </span>
          </div>
        </div>
      </fieldset>

      <div className="approve__foot">
        <button
          ref={p.approveRef}
          type="button"
          className="k-btn k-btn--primary k-btn--lg approve__btn"
          onClick={p.onApprove}
          disabled={off}
        >
          Approve
        </button>
      </div>
    </section>
  );
}
