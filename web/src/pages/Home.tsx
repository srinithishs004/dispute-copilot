import { Link } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { usePageTitle } from '../lib/usePageTitle';
import { ArrowRightIcon, InfoIcon } from '../components/Icons';

const STEPS = [
  { title: 'A buyer opens a dispute', text: 'PayPal tells Dispute Copilot through a webhook, so nothing needs checking by hand.' },
  { title: 'The evidence is gathered', text: 'The order, the payment and the dispute details are pulled into one place.' },
  { title: 'The AI recommends', text: 'Fight, offer a partial refund or accept, with the reasons and a draft letter.' },
  { title: 'You approve', text: 'Edit the letter if you like. Only then is the response sent to PayPal.' },
];

const PROVEN_RUN = [
  { label: 'Dispute opened', text: 'A buyer disputed a $25 Logo T-Shirt from the demo store.' },
  { label: 'Recommendation', text: 'Dispute Copilot recommended a $12.50 partial refund, with reasons and a letter.' },
  { label: 'Approved', text: 'The seller reviewed it and approved. The offer went to PayPal.' },
  { label: 'Resolved', text: 'The buyer accepted the offer and PayPal marked the case resolved.' },
];

export function Home() {
  usePageTitle('');
  const { user } = useAuth();

  return (
    <div className="page page--wide home">
      <section className="hero" aria-labelledby="hero-title">
        <p className="t-eyebrow eyebrow">PayPal disputes for small sellers</p>
        <h1 id="hero-title" className="t-display hero__title">
          Answer a PayPal dispute from one page.
        </h1>
        <p className="t-body-lg hero__lede">
          When a buyer opens a PayPal dispute, Dispute Copilot gathers the order evidence, recommends whether to
          fight, offer a refund or accept, explains why and drafts the letter. Nothing is sent until you approve it.
        </p>
        <div className="hero__actions">
          <Link to={user ? '/dashboard' : '/login'} className="k-btn k-btn--primary k-btn--lg">
            Try the seller demo
            <ArrowRightIcon size={18} />
          </Link>
          <a href="/store" className="k-btn k-btn--lg">
            Open the demo store
          </a>
        </div>
        <p className="sandbox-note">
          <InfoIcon size={16} />
          Runs on the PayPal sandbox. No real money moves.
        </p>
      </section>

      <section className="section" aria-labelledby="compare-title">
        <h2 id="compare-title" className="t-eyebrow eyebrow">
          What changes for the seller
        </h2>
        <div className="compare">
          <div className="k-card compare__card">
            <span className="t-eyebrow compare__tag">Before</span>
            <p className="t-body-lg compare__text">
              You read PayPal's case page, dig up the order details and write a reply by hand, all against a
              deadline.
            </p>
          </div>
          <div className="k-card compare__card">
            <span className="t-eyebrow compare__tag compare__tag--after">After</span>
            <p className="t-body-lg compare__text">
              You review one page with the evidence, a recommendation and a draft letter, then approve.
            </p>
          </div>
        </div>
      </section>

      <section className="section" aria-labelledby="how-title">
        <h2 id="how-title" className="t-h2 section__title">
          How it works
        </h2>
        <ol className="k-steps how">
          {STEPS.map((s, i) => (
            <li key={s.title} className="k-step">
              <span className="k-step__n">STEP {String(i + 1).padStart(2, '0')}</span>
              <span className="k-step__t">{s.title}</span>
              <span className="how__text">{s.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="section proven" aria-labelledby="proven-title">
        <div className="proven__intro">
          <h2 id="proven-title" className="t-h2 section__title">
            A real sandbox run
          </h2>
          <p className="t-body muted">
            This happened end to end on the PayPal sandbox with the code in this demo. The seller's only job was to
            read the recommendation and approve it.
          </p>
          <Link to="/guide" className="text-link">
            Run it yourself with the judge guide
            <ArrowRightIcon size={16} />
          </Link>
        </div>
        <ol className="k-tl proven__tl">
          {PROVEN_RUN.map((e, i) => (
            <li key={e.label} className={i === PROVEN_RUN.length - 1 ? 'now' : undefined}>
              <span className="tl__label">{e.label}</span>
              <p>{e.text}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
