# Link errors

A link tells a target which other entry it builds on. See [Targets and links](../configuration/targets-and-links.md).

| Code | Cause and fix |
|---|---|
| `link.missing` | The target needs a link, for example `validators`. Add `link: { validators: validators }` to the entry. |
| `link.entry.unknown` | The link names an `id` no entry has. Use the `id` of the entry that provides it. |
| `link.kind.not-provided` | That entry does not provide this kind. Link an entry whose target does. |
| `link.kind.not-consumed` | The Laravel target uses no link: it writes its own PHP types. Remove the link from its entry. |
| `link.kind.mismatch` | The linked entry gives another kind of output. Link the one the message names. |
| `link.cycle` | Two entries link to each other. Remove one link. |
| `link.client.errorStyle.unsupported` | The React, Vue and Angular targets need a fetch client with `errorStyle: result` (the default), and the linked client has `throw`. Set `errorStyle: result` on the client target, or link another client. See [Fetch client](../frontend/fetch-client.md#contracterror). |
| `link.apis.unpaired` | The linked entry does not generate an api this entry generates. Add it to the `apis` of the linked entry. |

## Next

[Generate errors](generate.md) when the links are right and a target still refuses.
