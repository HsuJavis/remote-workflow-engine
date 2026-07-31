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

// v8 Defer B (REQ-056): Host/Origin allowlist — DNS-rebinding + CSRF defense on the HTTP server.
// The allowlisted authorities are loopback (127.0.0.1 / localhost) at the server port, plus the
// configured bind host when bound to a non-loopback (LAN) address. A hostname carries an optional
// `:port`; we compare the host part against the allowset and, when a port is present, require it to
// match the server port (a rebinding attack presents a foreign Host name, not a foreign port).

function allowedHostSet(bind: string): Set<string> {
  const hosts = new Set<string>(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (bind && !isLoopback(bind) && bind !== '0.0.0.0' && bind !== '::') hosts.add(bind.toLowerCase());
  return hosts;
}

function splitHostPort(authority: string): { host: string; port?: string } {
  const a = authority.trim().toLowerCase();
  if (a.startsWith('[')) { // IPv6 literal, e.g. [::1]:8787
    const end = a.indexOf(']');
    if (end === -1) return { host: a };
    const host = a.slice(0, end + 1);
    const rest = a.slice(end + 1);
    return rest.startsWith(':') ? { host, port: rest.slice(1) } : { host };
  }
  const i = a.lastIndexOf(':');
  return i === -1 ? { host: a } : { host: a.slice(0, i), port: a.slice(i + 1) };
}

/** True when the request's `Host` header resolves to an allowlisted authority for this server. */
export function isAllowedHost(hostHeader: string | undefined, bind: string, port: number): boolean {
  if (!hostHeader) return false; // HTTP/1.1 requires Host; absent = reject (fail-closed)
  const { host, port: hp } = splitHostPort(hostHeader);
  if (!allowedHostSet(bind).has(host)) return false;
  return hp === undefined || hp === String(port); // if a port is present it must be ours
}

/** True when the request may proceed w.r.t. its `Origin`: absent Origin is ALLOWED (programmatic
 *  MCP clients / tests send none — fail-OPEN); a PRESENT Origin must be an allowlisted authority. */
export function isAllowedOrigin(originHeader: string | undefined, bind: string, port: number): boolean {
  if (originHeader === undefined || originHeader === '' || originHeader === 'null') return true;
  let authority: string;
  try {
    authority = new URL(originHeader).host; // host:port of the Origin
  } catch {
    return false; // malformed Origin → reject
  }
  const { host, port: op } = splitHostPort(authority);
  if (!allowedHostSet(bind).has(host)) return false;
  return op === undefined || op === String(port);
}
