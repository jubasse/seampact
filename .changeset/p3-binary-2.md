---
"@seampact/binary": patch
---

A release now builds the compiler binary with the first-party packs as npm publishes them, writes the binary pins from its `SHA256SUMS`, and ships one `seampact-compiler` wheel per platform, which `pip install "seampact-ir[compiler]"` pulls in.
