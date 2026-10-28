import { usePageTitle } from '../lib/usePageTitle';

export function Terms() {
  usePageTitle('Terms');
  return (
    <article className="page page--narrow prose">
      <p className="t-eyebrow eyebrow">Terms</p>
      <h1 className="t-h1">Terms</h1>
      <p className="t-body-lg muted">
        Dispute Copilot is a hackathon entry, provided as is for evaluation on the PayPal sandbox.
      </p>

      <h2 className="t-h3">Use</h2>
      <p>
        Use it to try the demo: buy from the demo store with a sandbox account, open a sandbox dispute and review the
        response. Do not enter real payment details or personal data.
      </p>

      <h2 className="t-h3">No warranty</h2>
      <p>
        The demo comes with no warranty of any kind. AI recommendations can be wrong, which is why nothing is sent
        until a person approves it.
      </p>

      <h2 className="t-h3">Not a PayPal product</h2>
      <p>Dispute Copilot is built by an independent team. It is not made, endorsed or supported by PayPal.</p>

      <h2 className="t-h3">Availability</h2>
      <p>The demo may be slow to start, change or be taken down after judging ends in December 2026.</p>

      <h2 className="t-h3">Contact</h2>
      <p>Contact the team through the hackathon page.</p>
    </article>
  );
}
