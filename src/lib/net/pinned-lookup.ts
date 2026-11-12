/**
 * A DNS `lookup` for outbound sockets that PINS the checked address
 * (server-only). The address policy runs inside the socket's own lookup, so
 * the address that was checked is exactly the address that is connected to;
 * a DNS answer that changes between "check" and "connect" (rebinding) cannot
 * slip a private address in. Shared by the calendar feed fetcher and the
 * agent's controlled fetch.
 */
import "server-only";

import { lookup as dnsLookup } from "node:dns/promises";

export interface ResolvedAddress {
  address: string;
  family: number;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

/** The system resolver, every answer in resolver order. */
export const systemResolve: Resolver = async (hostname) => dnsLookup(hostname, { all: true, verbatim: true });

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | ResolvedAddress[], family?: number) => void;

export type PinnedLookup = (
  hostname: string,
  options: { family?: number; all?: boolean } | number,
  callback: LookupCallback,
) => void;

/**
 * A `lookup` that resolves, rejects the host if ANY answer is not allowed
 * (with the error `denied()` makes), and hands exactly the checked answers to
 * the connection.
 */
export function pinnedLookup(resolve: Resolver, allowed: (ip: string) => boolean, denied: () => Error): PinnedLookup {
  return (hostname, options, callback) => {
    const opts = typeof options === "number" ? { family: options } : (options ?? {});
    resolve(hostname).then(
      (answers) => {
        if (!answers.length) {
          callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), "");
          return;
        }
        if (answers.some((a) => !allowed(a.address))) {
          callback(denied() as NodeJS.ErrnoException, "");
          return;
        }
        const usable = opts.family ? answers.filter((a) => a.family === opts.family) : answers;
        if (!usable.length) {
          callback(Object.assign(new Error("no address"), { code: "ENOTFOUND" }), "");
          return;
        }
        if (opts.all) callback(null, usable);
        else callback(null, usable[0].address, usable[0].family);
      },
      () => callback(Object.assign(new Error("lookup failed"), { code: "ENOTFOUND" }), ""),
    );
  };
}
