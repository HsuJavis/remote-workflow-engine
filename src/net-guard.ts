// D-BIND: fail-closed loopback bind guard (DES-029, TASK-036).
// Replaces any `=== '127.0.0.1'` string compare, which both false-rejects `::1` and is a
// prefix-match bypass risk (e.g. treating '127.0.0.1.evil.example.com' as loopback). This is a
// real IP-literal check (127.0.0.0/8 + ::1), not a textual prefix/DNS lookup — a bare hostname
// like 'localhost' is rejected fail-closed rather than resolved.

const IPV4_LOOPBACK = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function isValidOctet(s: string): boolean {
  const n = Number(s);
  return Number.isInteger(n) && n >= 0 && n <= 255;
}

export function isLoopback(bind: string): boolean {
  if (bind === '::1') return true;
  const m = IPV4_LOOPBACK.exec(bind);
  if (!m) return false;
  return m.slice(1).every(isValidOctet);
}
