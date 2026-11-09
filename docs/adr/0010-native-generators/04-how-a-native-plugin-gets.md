### How a native plugin gets the IR

- **Bundle source, the documented default.** The plugin fetches the pinned bundle (ADR 0011), verifies its integrity hash, and reads the precompiled IR. No compiler runs.
- **Local YAML source.** The plugin runs the standalone binary, pinned by hash, to compile the source to IR in a temporary directory, then reads that IR.

In both cases no Node.js installation is involved (CHK-076).
