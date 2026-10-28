import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError, UnauthorizedError, WakingUpError } from '../lib/api';
import {
  actionLabel,
  amountKept,
  deadlineText,
  money,
  outcomeLabel,
  paypalStatusLabel,
  reasonLabel,
  shortDate,
  stateLabel,
  stateTone,
} from '../lib/format';
import type { ApproveBody, ApproveResponse, DisputeAction, DisputeDetail } from '../lib/types';
import { usePageTitle } from '../lib/usePageTitle';
import { EmptyState } from '../components/EmptyState';
import { AlertIcon, ArrowLeftIcon, ClockIcon, FileTextIcon, SendIcon } from '../components/Icons';
import { useToast } from '../components/Toast';
import { ActionTimeline, failureText } from '../components/review/ActionTimeline';
import { ConfirmDialog } from '../components/review/ConfirmDialog';
import { EvidenceChecklist } from '../components/review/EvidenceChecklist';
import { LetterEditor, NOTE_MAX, NOTE_MIN, type FieldErrors } from '../components/review/LetterEditor';
import { ManualBanner } from '../components/review/ManualBanner';
import { RecommendationCard } from '../components/review/RecommendationCard';

const POLL_MS = 5000;
const POLL_STATES = new Set(['NEW', 'ANALYZING', 'ACTION_PENDING']);
const ORDER: DisputeAction[] = ['FIGHT', 'OFFER', 'ACCEPT'];
const AMOUNT_RE = /^\d+(\.\d{1,2})?$/;
const REJECTED_PREFIX = 'PayPal rejected the action';
const NOTE_ERROR = `Write between ${NOTE_MIN} and ${NOTE_MAX} characters.`;

function allowedList(d: DisputeDetail): DisputeAction[] {
  const a = d.allowedActions;
  if (!a) return [];
  return ORDER.filter((x) => (x === 'FIGHT' ? a.fight : x === 'OFFER' ? a.offer : a.accept));
}

function preferredAction(d: DisputeDetail): DisputeAction | null {
  const allowed = allowedList(d);
  const rec = d.latestAnalysis?.recommendation as DisputeAction | null | undefined;
  if (rec && allowed.includes(rec)) return rec;
  return allowed[0] ?? null;
}

function toCents(v: string): number {
  const [whole = '0', frac = ''] = v.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0').slice(0, 2));
}

function offerError(d: DisputeDetail): string {
  return `Enter an amount above ${money('0', d.currency)} and below ${money(d.amount, d.currency)}.`;
}

/** Checks the offer like the server does; returns the normalised "12.50" or null. */
function normaliseOffer(raw: string, d: DisputeDetail): string | null {
  const v = raw.trim().replace(/^\$/, '');
  if (!AMOUNT_RE.test(v)) return null;
  const cents = toCents(v);
  if (cents <= 0 || d.amount == null || cents >= toCents(d.amount)) return null;
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

type LoadError = 'notfound' | 'error' | null;

export function Review() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const toast = useToast();

  const [data, setData] = useState<DisputeDetail | null>(null);
  const [loadError, setLoadError] = useState<LoadError>(null);
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');

  // Editor state. `dirty` means the seller changed the letter or offer since it was last filled in.
  const [action, setAction] = useState<DisputeAction | null>(null);
  const [offer, setOffer] = useState('');
  const [note, setNote] = useState('');
  // A ref, not state: only the fill effect reads it, and it must not re-run that effect.
  const dirty = useRef(false);
  const [stale, setStale] = useState(false);
  const baseKey = useRef<string | null | undefined>(undefined);

  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const inFlight = useRef(false);

  const approveRef = useRef<HTMLButtonElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const offerRef = useRef<HTMLInputElement>(null);

  const item = data?.evidence?.facts.find((f) => f.id === 'order.item')?.value ?? null;
  const orderId = data?.evidence?.facts.find((f) => f.id === 'order.id')?.value ?? null;
  usePageTitle(item ? `${item} dispute` : 'Dispute review');

  const alive = useRef(true);
  const seq = useRef(0);
  const loading = useRef(0);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    loading.current += 1;
    try {
      const d = await api<DisputeDetail>(`/api/disputes/${encodeURIComponent(id)}`);
      if (!alive.current || mine !== seq.current) return;
      setData(d);
      setLoadError(null);
    } catch (err) {
      if (!alive.current || mine !== seq.current) return;
      if (err instanceof UnauthorizedError) {
        navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
        return;
      }
      if (err instanceof ApiError && err.status === 404) setLoadError('notfound');
      else setLoadError((prev) => prev ?? 'error');
    } finally {
      loading.current -= 1;
      // Always tick, so polling re-arms even when a newer load already settled.
      if (alive.current) setTick((t) => t + 1);
    }
  }, [id, navigate, location.pathname, location.search]);

  // Latest `load` for effects that must run only when the id changes.
  const loadRef = useRef(load);
  loadRef.current = load;

  // First load, and again if the id changes.
  useEffect(() => {
    setData(null);
    setLoadError(null);
    baseKey.current = undefined;
    void loadRef.current();
  }, [id]);

  // Pause while the tab is hidden; catch up as soon as it is visible again.
  useEffect(() => {
    const onChange = () => {
      const v = document.visibilityState !== 'hidden';
      setVisible(v);
      if (v) void load();
    };
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, [load]);

  // Poll every 5 s while the AI is working or an action is on its way to PayPal.
  const polling = !!data && POLL_STATES.has(data.localState);
  useEffect(() => {
    // Never stack a timer on a load that is still in flight (for example the tab-return fetch).
    if (!polling || !visible || loading.current > 0) return;
    const t = setTimeout(() => void load(), POLL_MS);
    return () => clearTimeout(t);
  }, [polling, visible, tick, load]);

  // A message about the last approve attempt is stale once the dispute moves on.
  const localState = data?.localState;
  useEffect(() => {
    setSubmitError(null);
  }, [localState]);

  // Fill the editor from the analysis, but never overwrite the seller's edits.
  useEffect(() => {
    if (!data) return;
    const analysis = data.latestAnalysis;
    const key = analysis?.createdAt ?? null;
    const allowed = allowedList(data);
    const fill = () => {
      setNote(analysis?.letterDraft ?? '');
      setOffer(analysis?.suggestedOffer ?? '');
      setAction(preferredAction(data));
      dirty.current = false;
      setStale(false);
      baseKey.current = key;
    };
    if (baseKey.current === undefined) {
      fill();
      return;
    }
    if (key !== baseKey.current) {
      if (dirty.current) setStale(true);
      else fill();
      return;
    }
    // Same analysis: keep the letter, only fix the action if PayPal stopped allowing it.
    setAction((cur) => (cur && allowed.includes(cur) ? cur : preferredAction(data)));
  }, [data]);

  const reloadLetter = () => {
    if (!data) return;
    const a = data.latestAnalysis;
    setNote(a?.letterDraft ?? '');
    setOffer(a?.suggestedOffer ?? '');
    setAction(preferredAction(data));
    dirty.current = false;
    setStale(false);
    setErrors({});
    baseKey.current = a?.createdAt ?? null;
  };

  const validate = (): { body: ApproveBody } | null => {
    if (!data || !action) return null;
    const next: FieldErrors = {};
    const trimmed = note.trim();
    if (trimmed.length < NOTE_MIN || trimmed.length > NOTE_MAX) next.note = NOTE_ERROR;
    let offerAmount: string | undefined;
    if (action === 'OFFER') {
      const v = normaliseOffer(offer, data);
      if (v === null) next.offer = offerError(data);
      else offerAmount = v;
    }
    setErrors(next);
    if (next.offer) offerRef.current?.focus();
    else if (next.note) noteRef.current?.focus();
    if (next.note || next.offer) return null;
    const body: ApproveBody = { action, note: trimmed };
    if (offerAmount !== undefined) body.offerAmount = offerAmount;
    return { body };
  };

  const onApprove = () => {
    setSubmitError(null);
    if (validate()) setConfirmOpen(true);
  };

  const onConfirm = async () => {
    if (inFlight.current) return;
    const ok = validate();
    if (!ok) {
      setConfirmOpen(false);
      return;
    }
    inFlight.current = true;
    setSending(true);
    setSubmitError(null);
    try {
      await api<ApproveResponse>(`/api/disputes/${encodeURIComponent(id)}/approve`, { method: 'POST', json: ok.body });
      if (!alive.current) return;
      setConfirmOpen(false);
      dirty.current = false;
      toast.show({ title: 'Sent to PayPal queue', body: 'This page updates when PayPal confirms.', tone: 'success' });
      void load();
    } catch (err) {
      if (!alive.current) return;
      setConfirmOpen(false);
      handleApproveError(err);
    } finally {
      inFlight.current = false;
      if (alive.current) setSending(false);
    }
  };

  const handleApproveError = (err: unknown) => {
    if (err instanceof UnauthorizedError) {
      navigate(`/login?next=${encodeURIComponent(location.pathname + location.search)}`, { replace: true });
      return;
    }
    if (err instanceof WakingUpError) {
      setSubmitError('Could not reach the server. Try again in a minute.');
      return;
    }
    if (!(err instanceof ApiError)) {
      setSubmitError('Something went wrong. Try again.');
      return;
    }
    if (err.status === 409) {
      if (err.message === 'action already pending') setSubmitError('An action is already pending');
      else if (err.message === 'action not allowed now') setSubmitError('PayPal no longer allows this action');
      else setSubmitError('This dispute changed, reloading');
      void load();
      return;
    }
    if (err.status === 400 && data) {
      if (err.message.startsWith('note')) {
        setErrors({ note: NOTE_ERROR });
        noteRef.current?.focus();
      } else if (err.message.startsWith('offerAmount')) {
        setErrors({ offer: offerError(data) });
        offerRef.current?.focus();
      } else {
        setSubmitError('Pick one of the actions PayPal allows.');
      }
      return;
    }
    if (err.status === 502) setSubmitError('Could not reach PayPal. Try again in a minute.');
    else if (err.status === 404) setSubmitError('We could not find this dispute');
    else if (err.status === 403) setSubmitError('This request was blocked. Reload the page and try again.');
    else setSubmitError('Something went wrong. Try again.');
  };

  if (loadError === 'notfound') {
    return (
      <div className="page page--wide">
        <EmptyState
          glyph={<FileTextIcon size={24} />}
          title="We could not find this dispute"
          actions={
            <Link to="/dashboard" className="k-btn">
              All disputes
            </Link>
          }
        >
          It may have been removed, or the link is wrong.
        </EmptyState>
      </div>
    );
  }

  if (!data && loadError === 'error') {
    return (
      <div className="page page--wide">
        <EmptyState
          glyph={<AlertIcon size={24} />}
          title="Could not load this dispute"
          actions={
            <>
              <button type="button" className="k-btn" onClick={() => void load()}>
                Try again
              </button>
              <Link to="/dashboard" className="k-btn k-btn--ghost">
                All disputes
              </Link>
            </>
          }
        >
          The server did not answer. Try again in a moment.
        </EmptyState>
      </div>
    );
  }

  if (!data) return <ReviewSkeleton />;

  const allowed = allowedList(data);
  const state = data.localState;
  const editable = state === 'READY_FOR_REVIEW' || state === 'NEEDS_MANUAL';
  const analyzing = state === 'ANALYZING' || state === 'NEW';
  const showEditor = editable || analyzing;
  const deadline = state === 'RESOLVED' ? null : deadlineText(data.responseDueAt);
  const deadlineTone = data.deadlineFlag === 'overdue' ? 'is-danger' : data.deadlineFlag === 'due_soon' ? 'is-warning' : '';
  const latest = data.actions[0] ?? null;
  const lastFailed = editable && latest?.state === 'FAILED' ? latest : null;
  const amountChanged = data.originalAmount != null && data.amount != null && Number(data.originalAmount) !== Number(data.amount);
  const recommended = (data.latestAnalysis?.recommendation as DisputeAction | null) ?? null;

  let disabledReason: string | null = null;
  if (analyzing) disabledReason = 'Approve opens once the AI has finished.';
  else if (allowed.length === 0) disabledReason = 'PayPal has no action open for this dispute, so there is nothing to approve.';

  const dialogAmount =
    action === 'OFFER'
      ? { label: 'Offer', value: money(normaliseOffer(offer, data) ?? offer, data.currency) }
      : action === 'ACCEPT'
        ? { label: 'Full refund', value: money(data.amount, data.currency) }
        : { label: 'Disputed', value: money(data.amount, data.currency) };

  return (
    <div className="page page--wide review">
      <header className="review-head">
        <Link to="/dashboard" className="back-link">
          <ArrowLeftIcon size={16} />
          All disputes
        </Link>
        <div className="review-head__title">
          <p className="t-eyebrow eyebrow review-head__case">Case {data.disputeId}</p>
          <h1 className="t-h1">{item ?? 'Dispute'}</h1>
          <p className="review-head__sub">
            <span>{reasonLabel(data.reason)}</span>
            {orderId ? (
              <>
                <span aria-hidden="true" className="dot-sep" />
                <span>
                  Order <span className="mono">{orderId}</span>
                </span>
              </>
            ) : null}
          </p>
        </div>
        <dl className="review-meta">
          <div className="review-meta__item review-meta__item--amount">
            <dt>Disputed</dt>
            <dd>
              <span className="review-amount">{money(data.amount, data.currency)}</span>
              {amountChanged ? <span className="review-amount__was">was {money(data.originalAmount, data.currency)}</span> : null}
            </dd>
          </div>
          <div className="review-meta__item">
            <dt>PayPal status</dt>
            <dd>{paypalStatusLabel(data.status)}</dd>
          </div>
          <div className="review-meta__item">
            <dt>Progress</dt>
            <dd>
              <span className={`k-badge k-badge--${stateTone(state)}`}>{stateLabel(state)}</span>
            </dd>
          </div>
          {deadline ? (
            <div className="review-meta__item">
              <dt>Respond by {shortDate(data.responseDueAt)}</dt>
              <dd className={`review-deadline ${deadlineTone}`}>
                <ClockIcon size={16} />
                {deadline}
              </dd>
            </div>
          ) : null}
        </dl>
      </header>

      {/* The failed-action alert below already says PayPal rejected it; do not say it twice. */}
      {state === 'NEEDS_MANUAL' && !(lastFailed && data.manualReason?.startsWith(REJECTED_PREFIX)) ? (
        <ManualBanner reason={data.manualReason} />
      ) : null}

      <div className="review-grid">
        <div className="review-col">
          <RecommendationCard
            analysis={data.latestAnalysis}
            localState={state}
            amount={data.originalAmount ?? data.amount}
            currency={data.currency}
          />

          <div className="review-alert-slot" role="alert">
            {submitError ? (
              <div className="k-alert alert--danger">
                <span className="k-alert__icon" aria-hidden="true">
                  <AlertIcon size={14} />
                </span>
                <div>
                  <strong>{submitError}</strong>
                </div>
              </div>
            ) : null}
          </div>

          {lastFailed ? (
            <div className="k-alert alert--danger">
              <span className="k-alert__icon" aria-hidden="true">
                <AlertIcon size={14} />
              </span>
              <div>
                <strong>Your last action did not go through</strong>
                <span>
                  {failureText(lastFailed)}
                  {allowed.length > 0 ? ' You can change the letter and approve again.' : ''}
                </span>
              </div>
            </div>
          ) : null}

          {showEditor ? (
            <LetterEditor
              allowed={allowed}
              recommended={recommended}
              action={action}
              onAction={(a) => {
                setAction(a);
                setErrors((e) => ({ ...e, offer: undefined }));
              }}
              offer={offer}
              onOffer={(v) => {
                setOffer(v);
                dirty.current = true;
                if (errors.offer) setErrors((e) => ({ ...e, offer: undefined }));
              }}
              note={note}
              onNote={(v) => {
                setNote(v);
                dirty.current = true;
                if (errors.note) setErrors((e) => ({ ...e, note: undefined }));
              }}
              currency={data.currency}
              errors={errors}
              disabled={!editable || sending}
              disabledReason={disabledReason}
              stale={stale}
              onReloadLetter={reloadLetter}
              onApprove={onApprove}
              approveRef={approveRef}
              noteRef={noteRef}
              offerRef={offerRef}
            />
          ) : (
            <StatusSummary data={data} />
          )}
        </div>

        <div className="review-col">
          <EvidenceChecklist evidence={data.evidence} />
          <ActionTimeline
            actions={data.actions}
            analysis={data.latestAnalysis}
            localState={state}
            outcome={data.outcome}
          />
        </div>
      </div>

      {confirmOpen && action ? (
        <ConfirmDialog
          action={action}
          amountLabel={dialogAmount?.label ?? null}
          amount={dialogAmount?.value ?? null}
          note={note}
          sending={sending}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => void onConfirm()}
          returnFocusRef={approveRef}
        />
      ) : null}
    </div>
  );
}

/** Replaces the approve area once the seller has acted. */
function StatusSummary({ data }: { data: DisputeDetail }) {
  const latest = data.actions[0] ?? null;
  const what = latest ? actionLabel(latest.type).toLowerCase() : 'response';

  if (data.localState === 'RESOLVED') {
    const kept = amountKept(data.originalAmount, data.amount, data.outcome);
    const original = data.originalAmount ?? data.amount;
    return (
      <section className="k-card review-card status-card" aria-labelledby="outcome-title">
        <h2 id="outcome-title" className="t-eyebrow eyebrow">
          Outcome
        </h2>
        <p className="status-card__title">{outcomeLabel(data.outcome)}</p>
        <div className="kept">
          <span className="kept__label">You kept</span>
          <span className="kept__value">{money(kept, data.currency)}</span>
          {original ? <span className="kept__of">of {money(original, data.currency)} disputed</span> : null}
        </div>
        <p className="muted">PayPal closed this case. Nothing else to do here.</p>
      </section>
    );
  }

  const pending = data.localState === 'ACTION_PENDING';
  return (
    <section className="k-card review-card status-card" aria-labelledby="status-title">
      <h2 id="status-title" className="t-eyebrow eyebrow">
        Your response
      </h2>
      <div className="status-card__row">
        <span className={`status-card__icon${pending ? ' is-pending' : ' is-sent'}`} aria-hidden="true">
          <SendIcon size={18} />
        </span>
        <div>
          <p className="status-card__title">{pending ? 'Sending to PayPal' : 'Sent to PayPal'}</p>
          <p className="muted">
            {pending
              ? `Your approved ${what} is queued for PayPal. This page checks every few seconds and updates by itself.`
              : `PayPal received your ${what}${latest?.sentAt ? ` on ${shortDate(latest.sentAt)}` : ''}. The reply from the buyer or PayPal will show here.`}
          </p>
        </div>
      </div>
    </section>
  );
}

function ReviewSkeleton() {
  return (
    <div className="page page--wide review" aria-busy="true" aria-label="Loading the dispute">
      <div className="review-head">
        <div className="k-skel skel-line skel-line--xs" />
        <div className="k-skel skel-title" />
        <div className="k-skel skel-line skel-line--sm" />
        <div className="review-meta review-meta--skel">
          <div className="k-skel skel-chip" />
          <div className="k-skel skel-chip" />
          <div className="k-skel skel-chip" />
        </div>
      </div>
      <div className="review-grid">
        <div className="review-col">
          <div className="k-skel skel-card skel-card--tall" />
          <div className="k-skel skel-card skel-card--xl" />
        </div>
        <div className="review-col">
          <div className="k-skel skel-card" />
          <div className="k-skel skel-card skel-card--tall" />
        </div>
      </div>
    </div>
  );
}
