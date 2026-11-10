### Options and registration

The target options are ADR 0026's: `handlers` (`perResource` only), `indent`, `rules`, `responses`, `bodyValidation`, `frameworkEtag` and `catchAll`, with unknown keys refused by name. Ninja adds `views`. The naming options and `layout` are refused as ADR 0026 refuses them. An operation's value wins over the api's, which wins over the target option.
