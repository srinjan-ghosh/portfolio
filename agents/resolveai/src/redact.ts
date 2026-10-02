// Step 1: strip sensitive data before any model sees the message.

const PATTERNS: { label: string; re: RegExp }[] = [
  // 13-19 digit card numbers, optionally separated by spaces or dashes
  { label: "CARD", re: /\b(?:\d[ -]?){12,18}\d\b/g },
  { label: "SSN", re: /\b\d{3}-\d{2}-\d{4}\b/g },
  { label: "PHONE", re: /(?:\+?\d{1,2}[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g },
];

export function redact(text: string): { text: string; count: number } {
  let count = 0;
  let out = text;
  for (const { label, re } of PATTERNS) {
    out = out.replace(re, () => {
      count++;
      return `[REDACTED_${label}]`;
    });
  }
  return { text: out, count };
}
