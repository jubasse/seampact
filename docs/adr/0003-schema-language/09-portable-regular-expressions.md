### 9. Portable regular expressions

`pattern` (and a scalar's pattern) accepts a subset that ECMAScript (with the `u` flag), java.util.regex, PCRE2 (PHP, with the `u` modifier) and RE2 can all read. The engines still disagree on what `.`, `\s` and `$` match, so the compiler parses every pattern and stores a normalised form in the IR, which each target translates for its engine; no target compiles the written text as is.

- Kept: literal characters; classes `[...]` with ranges and negation; `\d`, `\w`, `\s` and their negations; `.`; quantifiers `*`, `+`, `?`, `{n}`, `{n,}`, `{n,m}` (greedy); alternation `|`; groups `(...)` and `(?:...)`; anchors `^` and `$`.
- Escapes: only a metacharacter may be escaped (`\.`, `\*`, `\+`, `\?`, `\(`, `\)`, `\[`, `\]`, `\{`, `\}`, `\|`, `\\`, `\^`, `\$`, `\/`), plus `\-` inside a class. A literal `{`, `}` or `]` must be escaped everywhere, and a literal `-` inside a class except as its first or last character. ECMAScript with `u` refuses the other escapes and the lone brackets.
- Refused: backreferences, lookahead and lookbehind, named groups, lazy and possessive quantifiers, `\b`, Unicode property escapes (`\p{...}`), inline flags, and anything outside the lists above.
- Refused as backtracking exponentially, since ECMAScript, Java and PCRE2 run a pattern by backtracking on request text: a group repeated more than once whose tail holds a repetition of variable count over characters the group can start with, the repetition staying in the tail across optional parts and across required parts it overlaps (`(a+)+`, `(a*b?)*`, `(.*,)+`, `(a+a)+`), and a group repeated more than once whose branches can start with the same character, seen through a branch of an alternation and through a part run at most once whose neighbours are all optional (`(a|ab)*`, `(a|a)*`, `((a|ab))*`, `((a|aa)b?)*`, `((a|aa)|c)*`). A repeated group whose pieces cannot run into the next pass is kept (`^[a-z0-9]+(?:-[a-z0-9]+)*$`, `(\d+,)*`), as is a group under `?` or a fixed count inside a repeated group (`(\d{3}-)?`, `(ab{3})*`). These two shapes are what the check refuses, not every exponential pattern: `^((a|aa)a)*$`, where a required neighbour overlaps the alternation, is a known gap. The fix is a pattern without such a group, or the check in the application's code (A45).

The normalised meanings, matched per code point:

| Written | Means | Why |
|---|---|---|
| `.` | any code point except `\n`, `\r`, U+0085, U+2028, U+2029 | ECMAScript, Java, PCRE2 and RE2 each exclude a different set |
| `\d`, `\w`, `\s` | `[0-9]`, `[A-Za-z0-9_]`, `[\t\n\v\f\r ]` (ASCII); negations likewise | ECMAScript's `\s` holds Unicode spaces, RE2's lacks `\v` |
| `^`, `$` | the start and the end of the string, never before a final newline | written `^` and `$` for ECMAScript (no `m` flag) and RE2, `\A` and `\z` for Java and PCRE2 |

Semantics are JSON Schema's: a pattern matches anywhere in the string unless anchored, so Java targets use `find()`, never `matches()`. The shared payload table of the validator targets holds a case for each line above: `.` against U+0085 and U+2028, `\s` against `\v` and U+00A0, `$` before a final newline, an escaped `\-` in a class, an escaped `{`, and a recursive schema (section 2).
