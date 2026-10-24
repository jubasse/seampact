# Link errors

A link tells a target which other entry it builds on. See [Targets and links](../configuration/targets-and-links.md).

| You see | Do |
|---|---|
| `link.missing` | The target needs a link, for example `validators`. Add `link: { validators: validators }` to the entry. |
| `link.entry.unknown` | The link names an `id` no entry has. Use the `id` of the entry that provides it. |
| `link.kind.not-provided` | That entry does not provide this kind. Link an entry whose target does. |
| `link.kind.mismatch` | The linked entry gives another kind of output. Link the one the message names. |
| `link.cycle` | Two entries link to each other. Remove one link. |
| `link.client.errorStyle.unsupported` | The React target needs a fetch client with `errorStyle: result` (the default). Link such a client. |
| `link.apis.unpaired` | The linked entry does not generate an api this entry generates. Add it to the `apis` of the linked entry. |
