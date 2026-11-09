### API Platform spike

Before work on the PHP targets starts, a spike builds one API Platform operation that serves the default format (bare payload, problem+json errors) and, with the api-platform pack, JSON-LD items, a Hydra page and Hydra errors, with API Platform's own OpenAPI generation on (its default, which A43 leaves to the app), completed by `nativeDocs`, and off through `frameworkDocs: off`. It records which API Platform mechanisms the target configures and which it keeps ([A28](../../decisions.md#a28)), and in particular:

- how `security` without `object` is evaluated before the provider reads (API Platform 4.3), against the check order of ADR 0012;
- `@id` generation for a nested item whose parent id is not an item property, since the IRI converter needs every `uriVariable` from the object (`idProperty`, ADR 0002 section 6);
- the target's own reject of a restricted input field before denormalisation, since property `securityPostDenormalize` only strips ([A21](../../decisions.md#a21), A42);
- validation answered as the `schemaInvalid` 400 rather than 422, with `collectDenormalizationErrors` and `allow_extra_attributes: false`;
- the JSON-LD context routes, and the documentation and entrypoint routes while API Platform's document is on, as framework routes the boot check accepts (ADR 0008, ADR 0011);
- the `kernel.controller` listener finding the operation from `_api_operation_name`, and the generated decorator of the deserialize provider running after API Platform's read and before denormalisation (ADR 0012);
- which API Platform flavours the target supports (Symfony, and whether Laravel too).
