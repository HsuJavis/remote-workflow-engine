// D-BIND: fail-closed loopback bind guard (DES-029, TASK-036).
// Replaces any `=== '127.0.0.1'` string compare, which both false-rejects `::1` and is a
// prefix-match bypass risk (e.g. treating '127.0.0.1.evil.example.com' as loopback). This is a
// real IP-literal check (127.0.0.0/8 + ::1), not a textual prefix/DNS lookup — a bare hostname
// like 'localhost' is rejected fail-closed rather than resolved.

import type { IncomingHttpHeaders } from 'node:http';

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

function allowedHostSet(bind: string, extraHosts: readonly string[] = []): Set<string> {
  const hosts = new Set<string>(['127.0.0.1', 'localhost', '::1', '[::1]']);
  if (bind && !isLoopback(bind) && bind !== '0.0.0.0' && bind !== '::') hosts.add(bind.toLowerCase());
  // Operator-configured extra authorities (ServerConfig.allowedHosts): lets a LAN-IP / reverse-proxy
  // hostname be reached even while bound to 0.0.0.0 (whose default set is loopback-only). Each entry
  // is an explicit opt-in — the DNS-rebinding/CSRF floor still rejects any host NOT in this union.
  for (const h of extraHosts) { const t = h?.trim().toLowerCase(); if (t) hosts.add(t); }
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
export function isAllowedHost(hostHeader: string | undefined, bind: string, port: number, extraHosts: readonly string[] = []): boolean {
  if (!hostHeader) return false; // HTTP/1.1 requires Host; absent = reject (fail-closed)
  const { host, port: hp } = splitHostPort(hostHeader);
  if (!allowedHostSet(bind, extraHosts).has(host)) return false;
  return hp === undefined || hp === String(port); // if a port is present it must be ours
}

/** True when the request may proceed w.r.t. its `Origin`: absent Origin is ALLOWED (programmatic
 *  MCP clients / tests send none — fail-OPEN); a PRESENT Origin must be an allowlisted authority. */
export function isAllowedOrigin(originHeader: string | undefined, bind: string, port: number, extraHosts: readonly string[] = []): boolean {
  if (originHeader === undefined || originHeader === '' || originHeader === 'null') return true;
  let authority: string;
  try {
    authority = new URL(originHeader).host; // host:port of the Origin
  } catch {
    return false; // malformed Origin → reject
  }
  const { host, port: op } = splitHostPort(authority);
  if (!allowedHostSet(bind, extraHosts).has(host)) return false;
  return op === undefined || op === String(port);
}

// v15 (DES-097, ARCH-063, TASK-088): per-request loopback peer exemption for the D-BIND auth gate.
// DISTINCT from isLoopback(bind) — this checks the raw socket peer, not the bind address.
// Fail-closed: any forwarded/tunnel client-IP header present → NEVER exempt (D-AUTH-3 closes the
// cloudflared-on-loopback hole where a public tunnel proxy arrives with a loopback socket peer).
// Keys on the raw socket `remoteAddress` ONLY — never trusts headers to determine true identity.

const TUNNEL_HEADERS = ['x-forwarded-for', 'cf-connecting-ip', 'forwarded', 'x-real-ip'] as const;

function isLoopbackAddr(addr: string): boolean {
  if (addr === '::1') return true;
  const m = IPV4_LOOPBACK.exec(addr);
  if (m) return m.slice(1).every(isValidOctet);
  // IPv4-mapped loopback: ::ffff:127.x.x.x (dotted form) or ::ffff:7f00:xxxx (hex-pair form).
  // Missing this case spuriously 401s the self-update rescue path on dual-stack :: bind.
  const lower = addr.toLowerCase();
  if (lower.startsWith('::ffff:')) {
    const rest = lower.slice(7);
    const dm = /^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(rest);
    if (dm) return dm.slice(1).every(isValidOctet);
    // Hex-pair form: e.g. "7f00:0001" — two colon-separated hex groups where high byte of first is 0x7f (127).
    const parts = rest.split(':');
    if (parts.length === 2) {
      const hi = parseInt(parts[0]!, 16);
      return !isNaN(hi) && (hi >>> 8) === 0x7f;
    }
  }
  return false;
}

/**
 * True when the raw socket peer is a loopback address AND no tunnel/forwarded client-IP header
 * is present. Fail-closed: undefined/empty address → false. Distinct from isLoopback(bind).
 * (DES-097, D-AUTH-3)
 */
export function isLoopbackPeer(remoteAddress: string | undefined, headers: IncomingHttpHeaders): boolean {
  // Any tunnel/forwarded header → NEVER exempt (closes cloudflared-on-loopback hole)
  for (const h of TUNNEL_HEADERS) {
    if (headers[h] !== undefined) return false;
  }
  if (!remoteAddress) return false;
  return isLoopbackAddr(remoteAddress);
}
