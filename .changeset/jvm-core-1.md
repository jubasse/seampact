---
---

Java builds can now read and verify a pinned contract bundle and compile local contract sources with the hash-pinned standalone compiler, published to Maven repositories once per platform.
The standalone compiler binary now ignores `NODE_OPTIONS`, so no script from the environment runs inside it.
