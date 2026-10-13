# Dispute Copilot

Dispute Copilot is a PayPal disputes assistant for small sellers, built for the PayPal AI Hackathon. It talks to the PayPal sandbox APIs to help sellers understand and respond to disputes.

## Run locally

1. `npm install`
2. `cp .env.example .env` and fill in your PayPal sandbox credentials
3. `npm run dev`
4. `npm test`

## Testing against the PayPal sandbox

See [docs/runbooks/sandbox-dispute.md](docs/runbooks/sandbox-dispute.md) for creating a sandbox payment and a real dispute. Typecheck the spike scripts with `npm run typecheck:scripts -w server`.
