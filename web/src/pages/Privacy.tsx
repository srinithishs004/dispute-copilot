import { usePageTitle } from '../lib/usePageTitle';

export function Privacy() {
  usePageTitle('Privacy');
  return (
    <article className="page page--narrow prose">
      <p className="t-eyebrow eyebrow">Privacy</p>
      <h1 className="t-h1">Privacy</h1>
      <p className="t-body-lg muted">
        Dispute Copilot is a hackathon demo that runs on the PayPal sandbox. It has no real customers and handles no
        real money.
      </p>

      <h2 className="t-h3">What is stored</h2>
      <ul>
        <li>Sandbox orders and disputes from the demo store and the PayPal sandbox.</li>
        <li>The AI recommendations and draft letters made for those disputes.</li>
        <li>Approvals: which action was approved and when.</li>
        <li>A session cookie that keeps you signed in. It is removed when you sign out or after it expires.</li>
      </ul>

      <h2 className="t-h3">AI providers</h2>
      <p>
        To write a recommendation, dispute details are sent to Google Gemini, or to Groq if Gemini is unavailable.
        Email addresses are removed before anything is sent.
      </p>

      <h2 className="t-h3">No tracking</h2>
      <p>There is no analytics, no advertising and no tracking of any kind on this site.</p>

      <h2 className="t-h3">How long data is kept</h2>
      <p>The demo data may be deleted after judging ends in December 2026.</p>

      <h2 className="t-h3">Contact</h2>
      <p>Contact the team through the hackathon page.</p>
    </article>
  );
}
