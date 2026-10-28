import { useEffect, useId, useRef, type KeyboardEvent, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { actionLabel, firstLines } from '../../lib/format';
import type { DisputeAction } from '../../lib/types';

type Props = {
  action: DisputeAction;
  /** Formatted amount line for OFFER (offered) or ACCEPT (refunded); null for FIGHT. */
  amountLabel: string | null;
  amount: string | null;
  note: string;
  sending: boolean;
  onCancel(): void;
  onConfirm(): void;
  /** Where focus goes when the dialog closes (the Approve button). */
  returnFocusRef: RefObject<HTMLElement>;
};

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Restates exactly what goes to PayPal. Traps focus, closes on Escape, returns focus to the opener. */
export function ConfirmDialog({ action, amountLabel, amount, note, sending, onCancel, onConfirm, returnFocusRef }: Props) {
  const titleId = useId();
  const descId = useId();
  const box = useRef<HTMLDivElement>(null);
  const keep = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    keep.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      const back = returnFocusRef.current;
      if (back && back.isConnected) back.focus();
      else document.getElementById('main')?.focus();
    };
  }, [returnFocusRef]);

  // Both buttons are disabled while sending; hold focus on the dialog itself so it cannot fall to the page.
  useEffect(() => {
    if (sending) box.current?.focus();
    else if (box.current && document.activeElement === box.current) keep.current?.focus();
  }, [sending]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      if (!sending) onCancel();
      return;
    }
    if (e.key !== 'Tab' || !box.current) return;
    const items = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
    if (items.length === 0) {
      e.preventDefault();
      box.current.focus();
      return;
    }
    const first = items[0]!;
    const last = items[items.length - 1]!;
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !box.current.contains(active))) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && (active === last || !box.current.contains(active))) {
      e.preventDefault();
      first.focus();
    }
  };

  const { lines, more } = firstLines(note, 2);

  return createPortal(
    <div
      className="k-scrim confirm-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !sending) onCancel();
      }}
    >
      <div
        ref={box}
        className="k-dialog confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        aria-busy={sending || undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>Send this to PayPal?</h2>
        <p id={descId}>PayPal receives exactly this as soon as you send it.</p>
        <dl className="confirm__list">
          <div className="confirm__row">
            <dt>Action</dt>
            <dd>{actionLabel(action)}</dd>
          </div>
          {amountLabel && amount ? (
            <div className="confirm__row">
              <dt>{amountLabel}</dt>
              <dd className="confirm__amount">{amount}</dd>
            </div>
          ) : null}
          <div className="confirm__row confirm__row--letter">
            <dt>Letter</dt>
            <dd>
              <blockquote className="confirm__quote">
                {lines.map((l, i) => (
                  <p key={i}>{l}</p>
                ))}
              </blockquote>
              {more > 0 ? (
                <span className="confirm__more">
                  and {more} more {more === 1 ? 'line' : 'lines'}
                </span>
              ) : null}
            </dd>
          </div>
        </dl>
        <div className="k-dialog__actions">
          <button ref={keep} type="button" className="k-btn k-btn--ghost" onClick={onCancel} disabled={sending}>
            Keep editing
          </button>
          <button
            type="button"
            className="k-btn k-btn--primary"
            onClick={onConfirm}
            disabled={sending}
            aria-busy={sending || undefined}
          >
            Send to PayPal
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
