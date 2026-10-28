import type { EvidencePack } from './evidence.js';

export const EMAIL_RE = /[^\s@<>()\[\],;:"']+@[^\s@<>()\[\],;:"']+\.[^\s@<>()\[\],;:"']+/g;
export const stripFences = (s: string) => s.replace(/<<<|>>>/g, '');
const isEmailChar = (c: string) => !/[\s@<>()\[\],;:"']/.test(c);

/**
 * Same result as `s.replace(EMAIL_RE, '[email]')`, but linear: the regex backtracks
 * quadratically on long whitespace-free text such as JSON tool outputs.
 */
export function redactEmails(s: string): string {
  let out = '';
  let copied = 0; // s[0..copied) is already in out
  for (let at = s.indexOf('@'); at !== -1; at = s.indexOf('@', at + 1)) {
    let start = at;
    while (start > copied && isEmailChar(s[start - 1]!)) start--;
    if (start === at) continue;
    let end = at + 1;
    while (end < s.length && isEmailChar(s[end]!)) end++;
    // Domain needs a dot with at least one character on each side.
    const dot = s.slice(at + 2, end - 1).indexOf('.');
    if (dot === -1) continue;
    out += s.slice(copied, start) + '[email]';
    copied = end;
    at = end - 1;
  }
  return out + s.slice(copied);
}

/** One fact as a prompt line: fenced, fence sequences stripped, emails redacted. */
export const factLine = (f: EvidencePack['facts'][number]) =>
  `[${f.id}] ${f.label}: <<<${redactEmails(stripFences(f.value))}>>>`;
