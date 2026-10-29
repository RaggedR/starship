// algebra.ts — VENDORED from ~/git/gold/dungeon/lib/algebra.ts (Ghani's container
// combinators), trimmed for starship: the four combinators and the Runner types
// are kept verbatim in their type logic; the socket `leaf()` and its `./wire.ts`
// import are REMOVED (starship runs its officers in process), and a local
// decoding leaf `leafLocal` is added in their place. Nothing about the type-level
// construction changed — see the original for the full commentary on why a
// container presented as the UNION OF ITS FIBRES makes seqC's dependent pair
// expressible in TypeScript over a finite (tagged-union) shape index.

// ── A container is a union of fibres ──────────────────────────────────
/** One fibre: a shape, and the type of positions over it. Type-level only. */
export interface Fib<S, P> {
  readonly shape: S;
  readonly pos: P;
}

export type Cont = Fib<unknown, unknown>;

/** The shape type: the union of the fibres' shapes. */
export type Shape<C extends Cont> = C extends Fib<infer S, unknown> ? S : never;

/** The positions over ONE shape — the dependent lookup. `S extends S1` picks the
 *  fibre this (possibly narrower) shape lies in; disjoint shapes => exactly one. */
export type PosAt<C extends Cont, S> = C extends Fib<infer S1, infer P>
  ? (S extends S1 ? P : never)
  : never;

type TagOf<S> = S extends { tag: infer T extends string } ? T : never;

// ── The four monoidal structures, as type-level operations ────────────
/** sum (+) — routing. Disjoint union of shapes; each keeps its own positions. */
export type SumC<A extends Cont, B extends Cont> =
  | (A extends Fib<infer S, infer P> ? Fib<{ side: "left"; value: S }, P> : never)
  | (B extends Fib<infer S, infer P> ? Fib<{ side: "right"; value: S }, P> : never);

/** tensor (⊠) — parallelisation. Shapes multiply AND positions multiply. */
export type TensorC<A extends Cont, B extends Cont> = A extends Fib<infer SA, infer PA>
  ? B extends Fib<infer SB, infer PB>
    ? Fib<{ left: SA; right: SB }, { left: PA; right: PB }>
  : never
  : never;

/** product (×) — shapes multiply, positions are a SUM. Prompt both, answer one. */
export type ProductC<A extends Cont, B extends Cont> = A extends Fib<infer SA, infer PA>
  ? B extends Fib<infer SB, infer PB>
    ? Fib<{ a: SA; b: SB }, { side: "a"; value: PA } | { side: "b"; value: PB }>
  : never
  : never;

/** sequential composition (◁) — the dependent pair, fibrewise. `next` receives
 *  PA, the positions of THAT shape, not the union over all of A's positions. */
export type SeqC<A extends Cont, B extends Cont> = A extends Fib<infer SA, infer PA>
  ? B extends Fib<infer SB, infer PB>
    ? Fib<{ first: SA; next: (r: PA) => SB }, { first: PA; second: PB }>
  : never
  : never;

// ── Runners: a container together with a way of answering it ──────────
/** A container that can actually be prompted. `run` is `(p : P) -> R p`. */
export interface Runner<C extends Cont> {
  /** Phantom; never assigned. Keeps `C` in an INFERABLE position so seqC(a,b)
   *  does not silently infer `A = Cont` and collapse every downstream position
   *  to `unknown`. See the original algebra.ts for the full explanation. */
  readonly fibres?: C;
  readonly label: string;
  run<S extends Shape<C>>(shape: S, depth: number): Promise<PosAt<C, S>>;
}

/** The container a runner serves. `Of<typeof r>` reads back the fibres. */
export type Of<R> = R extends Runner<infer C> ? C : never;

/** Per-shape decoders for a leaf, keyed by tag, each checked against its own
 *  concrete position type. The validation boundary — what proves a reply is the
 *  shape we expected before we trust it as a typed position. */
export type Decoders<C extends Cont> = {
  [K in TagOf<Shape<C>>]: (
    u: unknown,
  ) => PosAt<C, Extract<Shape<C>, { tag: K }>> | null;
};

/** An IN-PROCESS leaf (starship's replacement for gold's socket `leaf()`).
 *
 *  `answer` plays the role the CLI hop played: it produces a RAW `unknown` reply
 *  to a shape — exactly what a subprocess or a language model would hand back.
 *  The decoder then validates it into a typed position, or the leaf throws. The
 *  boundary is real even though there is no socket: the officer's reply is
 *  untyped until the decoder vouches for it. This is leaf-claude.ts's pattern
 *  (~/git/gold/dungeon/leaf-claude.ts) with the transport collapsed to a call. */
export function leafLocal<C extends Cont>(
  label: string,
  answer: (shape: Shape<C>, depth: number) => Promise<unknown> | unknown,
  decoders: Decoders<C>,
): Runner<C> {
  return {
    label,
    async run<S extends Shape<C>>(shape: S, depth: number): Promise<PosAt<C, S>> {
      const raw = await answer(shape, depth);
      const tag = (shape as { tag: TagOf<Shape<C>> }).tag;
      const decode = decoders[tag];
      const value = decode(raw);
      if (value === null) {
        throw new Error(`${label}/${String(tag)}: reply did not validate`);
      }
      return value as PosAt<C, S>;
    },
  };
}

// ── The combinators as values ─────────────────────────────────────────
export interface Sum<A extends Cont, B extends Cont> extends Runner<SumC<A, B>> {
  left<S extends Shape<A>>(value: S): { side: "left"; value: S };
  right<S extends Shape<B>>(value: S): { side: "right"; value: S };
}

export function sumC<A extends Cont, B extends Cont>(
  a: Runner<A>,
  b: Runner<B>,
): Sum<A, B> {
  return {
    label: `(${a.label} + ${b.label})`,
    left: (value) => ({ side: "left", value }),
    right: (value) => ({ side: "right", value }),
    async run<S extends Shape<SumC<A, B>>>(shape: S, depth: number) {
      const s = shape as { side: "left" | "right"; value: Shape<A> & Shape<B> };
      const value = s.side === "left"
        ? await a.run(s.value, depth)
        : await b.run(s.value, depth);
      return value as PosAt<SumC<A, B>, S>;
    },
  };
}

export interface Tensor<A extends Cont, B extends Cont> extends Runner<TensorC<A, B>> {
  both<SA extends Shape<A>, SB extends Shape<B>>(left: SA, right: SB): { left: SA; right: SB };
}

export function tensorC<A extends Cont, B extends Cont>(
  a: Runner<A>,
  b: Runner<B>,
): Tensor<A, B> {
  return {
    label: `(${a.label} (x) ${b.label})`,
    both: (left, right) => ({ left, right }),
    async run<S extends Shape<TensorC<A, B>>>(shape: S, depth: number) {
      const s = shape as { left: Shape<A>; right: Shape<B> };
      // Both shapes supplied up front, both replies owed — independence enforced
      // by the shape type {left, right}: the right prompt cannot depend on the
      // left reply, because you had to build it first. Promise.all is concurrency.
      const [left, right] = await Promise.all([
        a.run(s.left, depth),
        b.run(s.right, depth),
      ]);
      return { left, right } as PosAt<TensorC<A, B>, S>;
    },
  };
}

export interface Product<A extends Cont, B extends Cont> extends Runner<ProductC<A, B>> {
  offer<SA extends Shape<A>, SB extends Shape<B>>(a: SA, b: SB): { a: SA; b: SB };
}

export function productC<A extends Cont, B extends Cont>(
  a: Runner<A>,
  b: Runner<B>,
  choose: (shape: { a: Shape<A>; b: Shape<B> }) => "a" | "b",
): Product<A, B> {
  return {
    label: `(${a.label} x ${b.label})`,
    offer: (x, y) => ({ a: x, b: y }),
    async run<S extends Shape<ProductC<A, B>>>(shape: S, depth: number) {
      const s = shape as { a: Shape<A>; b: Shape<B> };
      const side = choose(s);
      const value = side === "a"
        ? await a.run(s.a, depth)
        : await b.run(s.b, depth);
      return { side, value } as PosAt<ProductC<A, B>, S>;
    },
  };
}

export interface Seq<A extends Cont, B extends Cont> extends Runner<SeqC<A, B>> {
  /** The dependent pair's introduction rule. `SA` is inferred from `first`, so
   *  `next` is contextually typed at THAT fibre. */
  step<SA extends Shape<A>, SB extends Shape<B>>(
    first: SA,
    next: (r: PosAt<A, SA>) => SB,
  ): { first: SA; next: (r: PosAt<A, SA>) => SB };
}

export function seqC<A extends Cont, B extends Cont>(
  a: Runner<A>,
  b: Runner<B>,
): Seq<A, B> {
  return {
    label: `(${a.label} <| ${b.label})`,
    step: (first, next) => ({ first, next }),
    async run<S extends Shape<SeqC<A, B>>>(shape: S, depth: number) {
      const s = shape as { first: Shape<A>; next: (r: unknown) => Shape<B> };
      // Prompt the first; its reply CHOOSES the second prompt. That application
      // of `next` is the whole content of <| — control down, data up.
      const first = await a.run(s.first, depth);
      const second = await b.run(s.next(first), depth);
      return { first, second } as PosAt<SeqC<A, B>, S>;
    },
  };
}
