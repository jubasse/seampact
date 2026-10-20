# Contract bundle format, for native implementers

A contract bundle (ADR 0011 "The bundle") is a directory, or a gzipped tarball of it, holding `seampact-bundle.json` (the manifest, `manifest.schema.json`), `sources/` (the YAML sources as authored, the packs they apply vendored under `sources/.packs/<name>@<version>/`) and `ir/<api>.json` (the canonical IR of each api, `docs/ir/10-byte-stable-serialisation.md`). A Kotlin, PHP, .NET or Python reader verifies one with no Node.js by following this file; `@seampact/spec/bundle/vectors/vectors.json` holds the cases every reader must agree on.

## Paths

A listed path is relative to the bundle root, with forward slashes, under `sources/` or `ir/`; each segment is made of `A-Z a-z 0-9 . _ @ + -` only, and is neither empty, `.` nor `..`; at most 255 characters. The schema's `$defs/path` pattern states the rule without lookahead. With ASCII only, the UTF-16 code-unit order, the byte order and every language's ordinal string order agree, and no Unicode normalisation or locale question arises.

## Manifest rules

After the schema, a reader checks what no JSON Schema states:
- `files` is sorted by path in code-unit order, so no path is listed twice;
- no two paths are equal once ASCII letters are folded to lower case;
- each api is listed once, its `file` is `ir/<name>.json` and is in `files`, and every `ir/` file is an api's;
- `packs` is sorted by name then version, none twice.

The manifest is at most 1 MiB of UTF-8 JSON; a key `__proto__`, `constructor` or `prototype` anywhere refuses it.

## Integrity

The canonical file list is one line per listed file, `<sha256 lowercase hex><two spaces><path>\n`, the last line included, sorted by path in code-unit order, the manifest excluded, encoded as UTF-8 (`sha256sum -c` reads it). The integrity is `sha256-` followed by the padded standard base64 of the SHA-256 of that text (the SRI form npm uses).

## Tarball

Written: ustar, regular files only, no directory entries, every entry at the root (no leading directory), sorted by path in code-unit order (the manifest among them), mode `0644`, uid and gid 0, empty owner names, mtime 0, a path longer than 100 characters split into the prefix field; gzip at level 9, mtime 0, no file name, OS byte 255. The same bundle gives the same bytes on every machine.

Read: the whole archive is checked before any file is written, into a new temporary directory:
- caps: 64 MiB compressed, 256 MiB uncompressed, 10,000 entries;
- types `0` (and NUL) are files, `5` directories, `x` a pax header whose `path` and `size` apply to the next entry (other keys ignored), `g` ignored; any other type (links, devices, FIFOs, GNU long names) refuses the archive;
- a path that is empty, absolute, a drive path (`C:`), holds a backslash or NUL, or has an empty, `.` or `..` segment refuses it; so does a path given twice, two paths equal once folded to lower case, and a path that is both a file and a directory;
- the ustar magic (`ustar\0` with version `00`, or GNU's `ustar  \0`) and the header checksum must hold.

An npm package of a bundle has the bundle directory as its root; strip npm's `package/` prefix first.

## The pinned-bundle check

In order; a step runs only when the steps before it pass:
0. The manifest exists at the root, within its cap, is JSON with no reserved key, valid under the schema and the manifest rules.
1. Every regular file under the bundle (a link or special file refuses it; at most 10,000 files and 256 MiB): each listed file exists, with its size, then its SHA-256; no file is unlisted, but for `package.json`, `README*`, `LICENSE*`, `LICENCE*` and `CHANGELOG*` at the root of an npm package source. Failures in path order: the listed files, then the unlisted ones.
2. The integrity recomputed from the manifest's list equals the manifest's `integrity`, then the pinned one. A missing or differing pin fails and gives the recomputed value, so pinning is a copy.
3. For each api in manifest order: its IR is UTF-8 JSON with no reserved key; it declares the manifest's `irVersion` and `irRevision`; the reader's support check (ADR 0005: a version it reads, its exact `irRevision` before 1.0, the lists it reads well-formed) passes; the open IR JSON Schema accepts it.

## Failure codes

| Code | When | Names |
|---|---|---|
| `bundle.manifest-missing` | no manifest at the root | the manifest |
| `bundle.manifest-too-large` | manifest over 1 MiB | the manifest, cap and size |
| `bundle.manifest-invalid` | not JSON, a reserved key, the schema or a manifest rule | the manifest |
| `bundle.file-type` | a link or special file in the bundle | the file |
| `bundle.too-many-files` | over 10,000 files | the cap |
| `bundle.too-large` | files over 256 MiB in all | the cap |
| `bundle.file-missing` | a listed file is absent | the file |
| `bundle.file-size` | a listed file's size differs | the file, both sizes |
| `bundle.file-hash` | a listed file's SHA-256 differs | the file, both hashes |
| `bundle.file-unlisted` | a file the manifest does not list | the file |
| `bundle.integrity-mismatch` | the list gives another integrity than the manifest's | the manifest's and the recomputed value |
| `bundle.pin-missing` | no pin | the recomputed value |
| `bundle.pin-mismatch` | the pin differs | the pin and the recomputed value |
| `bundle.ir-unreadable` | an IR is not UTF-8 JSON, or holds a reserved key | the file |
| `bundle.ir-declaration` | an IR's `irVersion` or `irRevision` differs from the manifest's | the file, both as `<version>.<revision>` |
| `bundle.ir-version` | an `irVersion` the reader does not read | the file, both values |
| `bundle.ir-revision` | another `irRevision` (before 1.0) | the file, both values |
| `bundle.ir-invalid` | the support check finds a malformed list, or the IR JSON Schema refuses it | the file |
| `bundle.archive-too-large` | tarball over 64 MiB | cap and size |
| `bundle.archive-extracted-too-large` | over 256 MiB uncompressed | the cap |
| `bundle.archive-too-many-entries` | over 10,000 entries | the cap |
| `bundle.archive-invalid` | not gzip, a bad header, magic, checksum, size or pax record, or truncated | the entry when known |
| `bundle.archive-entry-path` | an unsafe path, or a file and a directory at one path | the entry |
| `bundle.archive-entry-type` | an entry type other than a file, a directory or a pax header | the entry |
| `bundle.archive-entry-duplicate` | a path twice, or twice once folded to lower case | the entry |

The writer's own codes (`bundle.compile-failed`, `bundle.contract-missing`, `bundle.file-outside-root`, `bundle.path-unportable`, `bundle.pack-unreadable`, `bundle.output-not-empty`) concern Node only.

## Vectors

`vectors.json` holds `directories`: a bundle's files (`path`, `base64` bytes), the source `channel` (`package` allows npm's own files), the `pin` (`null` for none), and the `expected` outcome: `ok`, the recomputed `integrity` (`null` when step 1 or the manifest failed) and the `failures` in order, each with its `code` and, when set, `file`, `expected` and `actual`. And `archives`: a tarball's `base64` bytes and the `expected` outcome, `ok` with the entry `paths` in archive order, or the `failures`. A reader compares every field the vector records; messages are never compared.
