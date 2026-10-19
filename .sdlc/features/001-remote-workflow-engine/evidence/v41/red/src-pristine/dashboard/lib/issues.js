// src/dashboard/lib/issues.js
// DES-217, ARCH-134, ARCH-133, ARCH-123, TASK-224, REQ-139/REQ-067 — ONE export, pure, total.
//
// An issue's title/URL is attacker-influenceable content on an UNAUTHENTICATED page: anyone can
// open a GitHub issue whose body contains a `javascript:`/`data:` URL, and `issue-reporter.ts`
// republishes it verbatim. `safeIssueHref` is the one gate between that string and a live,
// clickable `href` — `https:` protocol only, else `null` so the caller renders the row as TEXT
// with no link. `new URL()` throws on plenty of real-world non-URLs (a relative path, garbage);
// that throw is caught here so this function itself never throws.
export function safeIssueHref(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}
