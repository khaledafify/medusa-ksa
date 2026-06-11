---
"@medusa-ksa/core": patch
---

Widen `validateOptions`/`createLoader` generics to accept Zod schemas whose
input and output types differ (e.g. fields with `.default()`), returning the
schema's output type.
