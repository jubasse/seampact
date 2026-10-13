// A leaf module: it imports nothing, so `pipeline/` and `derivations/` both import it without a cycle.

/** A value no pass may change: the raw tree, the workspace, the drafts of other apis, the derivation data. */
export type PassReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer E)[]
    ? readonly PassReadonly<E>[]
    : T extends object
      ? { readonly [K in keyof T]: PassReadonly<T[K]> }
      : T;

/** The writable form of a value read through `PassReadonly`: what `pipelineCopy` returns. */
export type PassWritable<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer E)[]
    ? PassWritable<E>[]
    : T extends object
      ? { -readonly [K in keyof T]: PassWritable<T[K]> }
      : T;
