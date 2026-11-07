# Contract key errors: validate

Codes that start with `seampact/validate/` say a key or a value is not allowed. The message gives the fix, often the list of keys you may write.

| You see | Do |
|---|---|
| `seampact/validate/unknown-keyword` | The key is not allowed at that place. Remove it, or fix its spelling: the message may say `Did you mean ...`. A key written one level too far left becomes a setting of the node above: check the indent. |
| `seampact/validate/missing-keyword` | Add the key the message names. |
| `seampact/validate/wrong-type` | Write the type the message names, for example a mapping instead of a list. |
| `seampact/validate/invalid-value` | Write one of the values the message lists, or a number in the range it gives. |
| `seampact/validate/invalid-name` | Schema names start with an uppercase letter (`Note`), other names with a lowercase one (`notes`); then letters, digits or `_`. |
| `seampact/validate/reason-required` | A safety exception needs a reason: `access: { public: "Anyone may call this api." }`. |
| `seampact/validate/conflicting-keywords` | Two keys exclude each other. Keep one. |

See the [grammar](../grammar/) for every key.
