import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { usePageTitle } from '../lib/usePageTitle';
import { CopyIcon, InfoIcon } from '../components/Icons';
import { useToast } from '../components/Toast';

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Buy an item from the demo store',
    body: (
      <>
        Open the <a href="/store">demo store</a> and buy any item. Pay with the sandbox buyer account below.
      </>
    ),
  },
  {
    title: 'Open a dispute as the buyer',
    body: (
      <>
        Sign in to the{' '}
        <a href="https://www.sandbox.paypal.com" target="_blank" rel="noreferrer">
          PayPal sandbox
        </a>{' '}
        as the same buyer, find the purchase and open a dispute on it.
      </>
    ),
  },
  {
    title: 'Wait about 5 minutes',
    body: 'PayPal sends the dispute to Dispute Copilot by webhook, then the AI gathers the evidence and writes its analysis.',
  },
  {
    title: 'Sign in and open the dispute',
    body: (
      <>
        <Link to="/login">Sign in</Link> with the judge login below and open the dispute from the dashboard.
      </>
    ),
  },
  {
    title: 'Review and approve',
    body: 'Read the evidence, the recommendation and the letter. Edit the letter if you want, then approve.',
  },
  {
    title: 'Accept the offer as the buyer',
    body: 'Back in the PayPal sandbox as the buyer, open the dispute and accept the seller’s offer.',
  },
  {
    title: 'See the case resolved',
    body: 'Return to the dispute in Dispute Copilot. The timeline shows the case marked resolved.',
  },
];

type Value = string | undefined;

function CredentialRow({ label, value, copyName }: { label: string; value: Value; copyName: string }) {
  const toast = useToast();
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      toast.show({ title: `${copyName} copied`, tone: 'success', durationMs: 2500 });
    } catch {
      toast.show({ title: 'Could not copy', body: 'Select the text and copy it instead.', tone: 'warning' });
    }
  };
  return (
    <div className="cred">
      <dt className="cred__label">{label}</dt>
      <dd className="cred__value">
        {value ? (
          <>
            <code className="cred__code">{value}</code>
            <button
              type="button"
              className="k-btn k-btn--ghost k-btn--sm k-icon-btn"
              aria-label={`Copy ${copyName.toLowerCase()}`}
              onClick={copy}
            >
              <CopyIcon size={16} />
            </button>
          </>
        ) : (
          <span className="cred__missing">Ask the team for this value</span>
        )}
      </dd>
    </div>
  );
}

const env = (v: unknown): Value => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

export function Guide() {
  usePageTitle('Judge guide');
  const judgeEmail = env(import.meta.env.VITE_JUDGE_EMAIL);
  const judgePassword = env(import.meta.env.VITE_JUDGE_PASSWORD);
  const buyerEmail = env(import.meta.env.VITE_SANDBOX_BUYER_EMAIL);
  const buyerPassword = env(import.meta.env.VITE_SANDBOX_BUYER_PASSWORD);

  return (
    <div className="page guide">
      <header className="page__head">
        <p className="t-eyebrow eyebrow">Judge guide</p>
        <h1 className="t-h1">Run one dispute from purchase to resolution</h1>
        <p className="t-body-lg muted">
          You play both sides: the buyer who opens the dispute in the PayPal sandbox, and the seller who reviews and
          approves the response here. Most of the time is spent waiting for PayPal.
        </p>
      </header>

      <ol className="walk">
        {STEPS.map((s, i) => (
          <li key={s.title} className="walk__step">
            <span className="walk__n" aria-hidden="true">
              {String(i + 1).padStart(2, '0')}
            </span>
            <div className="walk__body">
              <h2 className="t-h3 walk__title">{s.title}</h2>
              <p className="t-body muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>

      <section className="section" aria-labelledby="logins-title">
        <h2 id="logins-title" className="t-h2 section__title">
          Logins for the demo
        </h2>
        <div className="creds">
          <div className="k-card">
            <h3>Judge login</h3>
            <p>Signs in to Dispute Copilot as a seller. It can review and approve, but not run admin tasks.</p>
            <dl className="cred-list">
              <CredentialRow label="Email" value={judgeEmail} copyName="Judge email" />
              <CredentialRow label="Password" value={judgePassword} copyName="Judge password" />
            </dl>
          </div>
          <div className="k-card">
            <h3>Sandbox buyer</h3>
            <p>A PayPal sandbox test account. It holds no real money.</p>
            <dl className="cred-list">
              <CredentialRow label="Email" value={buyerEmail} copyName="Buyer email" />
              <CredentialRow label="Password" value={buyerPassword} copyName="Buyer password" />
            </dl>
          </div>
        </div>
      </section>

      <div className="k-alert k-alert--info guide__limit">
        <span className="k-alert__icon" aria-hidden="true">
          <InfoIcon size={14} />
        </span>
        <div>
          <strong>Known limitation</strong>
          <span>
            The PayPal sandbox refuses the seller’s own settle step, so a case only reaches an outcome when the buyer
            accepts the offer.
          </span>
        </div>
      </div>
    </div>
  );
}
