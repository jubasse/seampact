### 1. One IR document per api

A workspace compiles to one IR document per api. A cross-api reference (`relays`) names the other api and the operation id; the target api's IR is either a sibling in the same compile or the IR inside a pinned bundle (ADR 0011). The IR is JSON. Its JSON Schema, published in `@seampact/spec`, is written in the subset of ADR 0003 (tagged unions on a `kind` member, no `anyOf`, maps for catalogues), so that the Kotlin and PHP models can be generated from it without hand-written parts (FR-40).
