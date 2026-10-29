// ids.ts — correlation ids and timestamps, as INJECTABLE seams.
//
// MacBeth's Note 5 §6 ("what is NOT state"): the clock and the id source are not
// part of the world. They are ambient effects, threaded in as parameters. That is
// not a stylistic choice here — it is what makes the Definition of Done reachable.
// The DoD says the demo must replay "to the same answer twice", byte-identical.
// Real ULIDs mix wall-clock time with crypto randomness, so two runs would differ
// in every correlation id. So we define two implementations of each seam:
//
//   realIds()/realClock()      — production: time + randomness, never reproducible
//   seededIds()/fixedClock()   — demo & tests: deterministic, byte-identical
//
// Both id sources emit a ULID: a 26-char Crockford base32 string. The seeded one
// is still a well-formed, monotonic id — it just comes from a counter instead of a
// clock, so it repeats exactly across runs.

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Encode a non-negative integer as `width` Crockford base32 chars, left-padded. */
function toCrockford(n: number, width: number): string {
  let s = "";
  let v = Math.max(0, Math.floor(n));
  while (v > 0) {
    s = CROCKFORD[v % 32] + s;
    v = Math.floor(v / 32);
  }
  return s.padStart(width, "0").slice(-width);
}

// ── Id source ─────────────────────────────────────────────────────────
export interface IdSource {
  /** A fresh 26-char id. Monotonic within a source. */
  next(): string;
}

/** Deterministic ids: a fixed 10-char prefix derived from `seed`, then a 16-char
 *  counter. Same seed + same call order => same ids, every run. */
export function seededIds(seed: string): IdSource {
  // A cheap, stable 50-bit hash of the seed for the "timestamp" prefix slot.
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 1_125_899_906_842_623;
  const prefix = toCrockford(h, 10);
  let counter = 0;
  return {
    next() {
      return prefix + toCrockford(counter++, 16);
    },
  };
}

/** Real ULIDs: 48-bit ms time prefix + 80 bits of randomness. Not reproducible,
 *  which is correct for production — every id is globally unique. */
export function realIds(): IdSource {
  return {
    next() {
      const ms = Date.now();
      const time = toCrockford(ms, 10);
      const bytes = new Uint8Array(16); // 16 Crockford chars of randomness
      crypto.getRandomValues(bytes);
      let rand = "";
      for (const b of bytes) rand += CROCKFORD[b % 32];
      return time + rand; // 10 + 16 = 26
    },
  };
}

// ── Clock ─────────────────────────────────────────────────────────────
export interface Clock {
  /** An ISO-8601 timestamp string for a log record. */
  now(): string;
}

/** A clock that starts at `startMs` and advances by `stepMs` on every read, so a
 *  replay stamps identical timestamps in identical order. */
export function fixedClock(startMs = 1_760_000_000_000, stepMs = 1_000): Clock {
  let t = startMs;
  return {
    now() {
      const iso = new Date(t).toISOString();
      t += stepMs;
      return iso;
    },
  };
}

/** Wall-clock time. Production. */
export function realClock(): Clock {
  return { now: () => new Date().toISOString() };
}
