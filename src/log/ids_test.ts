// ids_test.ts — the determinism seam actually determines.

import { assertEquals, assertNotEquals } from "jsr:@std/assert@1";
import { fixedClock, realIds, seededIds } from "./ids.ts";

Deno.test("seededIds: same seed + same order => identical ids (the DoD seam)", () => {
  const a = seededIds("minefield-demo");
  const b = seededIds("minefield-demo");
  const seqA = [a.next(), a.next(), a.next()];
  const seqB = [b.next(), b.next(), b.next()];
  assertEquals(seqA, seqB);
});

Deno.test("seededIds: 26-char Crockford, monotonic", () => {
  const s = seededIds("x");
  const id = s.next();
  assertEquals(id.length, 26);
  assertEquals(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(id), true);
  assertEquals(s.next() < s.next(), true); // counter rises
});

Deno.test("realIds: 26-char, distinct across calls (not reproducible, by design)", () => {
  const r = realIds();
  const id = r.next();
  assertEquals(id.length, 26);
  assertEquals(/^[0-9ABCDEFGHJKMNPQRSTVWXYZ]{26}$/.test(id), true);
  assertNotEquals(r.next(), r.next());
});

Deno.test("fixedClock: deterministic, advancing timestamps", () => {
  const c1 = fixedClock();
  const c2 = fixedClock();
  const t1 = [c1.now(), c1.now()];
  const t2 = [c2.now(), c2.now()];
  assertEquals(t1, t2); // same across runs
  assertEquals(t1[0] < t1[1], true); // advances
});
