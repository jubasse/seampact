---
"@seampact/compiler": minor
---

The compiler orders a workspace's apis by their relay routes, refuses a relay cycle with `seampact/workspace/relay-cycle`, and finalizes each api into a validated, canonically ordered IR with byte-stable text (`finalizeSerializeIr`) and its source-location side table.
