import { AlertIcon } from '../Icons';

const MESSAGES: [prefix: string, text: string][] = [
  ['AI draft unavailable', 'The AI could not draft a letter. Write it yourself and approve.'],
  ['PayPal rejected the action', 'PayPal rejected the last action. Check the case in PayPal before approving again.'],
  ['no matching order', 'We could not match this dispute to a store order.'],
  ['No PayPal action is open', 'PayPal has no action open for you right now.'],
];

/** Plain words for the server's `manualReason`, matched by prefix; unknown reasons are shown as they are. */
export function manualMessage(reason: string): string {
  return MESSAGES.find(([prefix]) => reason.startsWith(prefix))?.[1] ?? reason;
}

export function ManualBanner({ reason }: { reason: string | null }) {
  return (
    <div className="k-alert k-alert--warning manual-banner">
      <span className="k-alert__icon" aria-hidden="true">
        <AlertIcon size={14} />
      </span>
      <div>
        <strong>This dispute needs you</strong>
        <span>{reason ? manualMessage(reason) : 'The AI stopped here. Review the case and approve the action yourself.'}</span>
      </div>
    </div>
  );
}
