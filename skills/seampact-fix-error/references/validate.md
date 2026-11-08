<!-- Generated from docs/troubleshooting/validate.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Contract key errors: validate

Page: https://jubasse.github.io/seampact/troubleshooting/validate/

Codes that start with `seampact/validate/` say a key or a value is not allowed. The message gives the fix, often the list of keys you may write.

| Code | Cause and fix |
|---|---|
| `seampact/validate/unknown-keyword` | The key is not allowed at that place. Remove it, or fix its spelling: the message may say `Did you mean ...`. A key written one level too far left becomes a setting of the node above: check the indent. |
| `seampact/validate/missing-keyword` | A required key is absent. Add the key the message names. |
| `seampact/validate/wrong-type` | The value has the wrong type, for example a list where a mapping goes. Write the type the message names. |
| `seampact/validate/invalid-value` | The value is not allowed. Write one of the values the message lists, or a number in the range it gives. |
| `seampact/validate/invalid-name` | Schema names start with an uppercase letter (`Note`), other names with a lowercase one (`notes`); then letters, digits or `_`. |
| `seampact/validate/reason-required` | A safety exception needs a reason: `access: { public: "Anyone may call this api." }`. |
| `seampact/validate/conflicting-keywords` | Two keys exclude each other. Keep one. |

See the [grammar](https://github.com/jubasse/seampact/tree/develop/docs/grammar) for every key.
