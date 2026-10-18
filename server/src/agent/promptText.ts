import type { EvidencePack } from './evidence.js';

export const EMAIL_RE = /[^\s@<>()\[\],;:"']+@[^\s@<>()\[\],;:"']+\.[^\s@<>()\[\],;:"']+/g;
export const stripFences = (s: string) => s.replace(/<<<|>>>/g, '');
export const redactEmails = (s: string) => s.replace(EMAIL_RE, '[email]');

/** One fact as a prompt line: fenced, fence sequences stripped, emails redacted. */
export const factLine = (f: EvidencePack['facts'][number]) =>
  `[${f.id}] ${f.label}: <<<${redactEmails(stripFences(f.value))}>>>`;
