### 10. Byte-stable serialisation

The IR file is the IR value serialised as:

- UTF-8, no byte order mark, LF line endings, a final newline;
- object members sorted by the UTF-16 code units of their names (the order of RFC 8785), two-space indentation;
- strings escaped as RFC 8785 does; numbers as RFC 8785 does (all IR numbers are integers; numeric refinements are decimal literal strings, section 13);
- durations as integer milliseconds, sizes as integer bytes, dates as `YYYY-MM-DD` strings, instants never generated;
- text read through `$file` with line endings normalised to LF and a byte order mark removed; no other Unicode normalisation;
- no absolute path, file name, time, host, user, locale-dependent value or source position.

The same contract gives the same bytes on linux, macOS and Windows, under any `TZ`, `LANG` and checkout line ending (FR-9, SCN-015, SM-3). A bundle's integrity hash is computed over these bytes (ADR 0011).
