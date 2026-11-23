//! The derivation ids of the derivation table (ADR 0006 section 5), one constant per row.
//!
//! A stage that writes or tests `derivedFrom.derivation` names the row here instead of retyping
//! its text; the pack row `pack.<pack>.<entry>` has no constant.

use crate::DerivationId;

/// The `input.invalid` row of the derivation table.
pub const INPUT_INVALID: DerivationId = DerivationId::from_static("input.invalid");

/// The `body.limit` row of the derivation table.
pub const BODY_LIMIT: DerivationId = DerivationId::from_static("body.limit");

/// The `body.media` row of the derivation table.
pub const BODY_MEDIA: DerivationId = DerivationId::from_static("body.media");

/// The `identity.authenticate` row of the derivation table.
pub const IDENTITY_AUTHENTICATE: DerivationId = DerivationId::from_static("identity.authenticate");

/// The `csrf.cookieWrite` row of the derivation table.
pub const CSRF_COOKIE_WRITE: DerivationId = DerivationId::from_static("csrf.cookieWrite");

/// The `idempotency.write` row of the derivation table.
pub const IDEMPOTENCY_WRITE: DerivationId = DerivationId::from_static("idempotency.write");

/// The `concurrency.version` row of the derivation table.
pub const CONCURRENCY_VERSION: DerivationId = DerivationId::from_static("concurrency.version");

/// The `member.notFound` row of the derivation table.
pub const MEMBER_NOT_FOUND: DerivationId = DerivationId::from_static("member.notFound");

/// The `owner.caller` row of the derivation table.
pub const OWNER_CALLER: DerivationId = DerivationId::from_static("owner.caller");

/// The `principal.requires` row of the derivation table.
pub const PRINCIPAL_REQUIRES: DerivationId = DerivationId::from_static("principal.requires");

/// The `binding.mismatch` row of the derivation table.
pub const BINDING_MISMATCH: DerivationId = DerivationId::from_static("binding.mismatch");

/// The `requirement.errors` row of the derivation table.
pub const REQUIREMENT_ERRORS: DerivationId = DerivationId::from_static("requirement.errors");

/// The `scope.errors` row of the derivation table.
pub const SCOPE_ERRORS: DerivationId = DerivationId::from_static("scope.errors");

/// The `fieldRight.restricted` row of the derivation table.
pub const FIELD_RIGHT_RESTRICTED: DerivationId = DerivationId::from_static("fieldRight.restricted");

/// The `sortKey.restricted` row of the derivation table.
pub const SORT_KEY_RESTRICTED: DerivationId = DerivationId::from_static("sortKey.restricted");

/// The `rule.proof` row of the derivation table.
pub const RULE_PROOF: DerivationId = DerivationId::from_static("rule.proof");

/// The `rule.bucket` row of the derivation table.
pub const RULE_BUCKET: DerivationId = DerivationId::from_static("rule.bucket");

/// The `identity.header` row of the derivation table.
pub const IDENTITY_HEADER: DerivationId = DerivationId::from_static("identity.header");

/// The `identity.deadline` row of the derivation table.
pub const IDENTITY_DEADLINE: DerivationId = DerivationId::from_static("identity.deadline");

/// The `identity.versionToken` row of the derivation table.
pub const IDENTITY_VERSION_TOKEN: DerivationId = DerivationId::from_static("identity.versionToken");

/// The `signed.identity` row of the derivation table.
pub const SIGNED_IDENTITY: DerivationId = DerivationId::from_static("signed.identity");

/// The `identity.unknownKeys` row of the derivation table.
pub const IDENTITY_UNKNOWN_KEYS: DerivationId = DerivationId::from_static("identity.unknownKeys");

/// The `input.unknownKeys` row of the derivation table.
pub const INPUT_UNKNOWN_KEYS: DerivationId = DerivationId::from_static("input.unknownKeys");

/// The `union.headerTag` row of the derivation table.
pub const UNION_HEADER_TAG: DerivationId = DerivationId::from_static("union.headerTag");

/// The `cache.headers` row of the derivation table.
pub const CACHE_HEADERS: DerivationId = DerivationId::from_static("cache.headers");

/// The `cache.etag` row of the derivation table.
pub const CACHE_ETAG: DerivationId = DerivationId::from_static("cache.etag");

/// The `cache.sensitive` row of the derivation table.
pub const CACHE_SENSITIVE: DerivationId = DerivationId::from_static("cache.sensitive");

/// The `paging.params` row of the derivation table.
pub const PAGING_PARAMS: DerivationId = DerivationId::from_static("paging.params");

/// The `paging.gone` row of the derivation table.
pub const PAGING_GONE: DerivationId = DerivationId::from_static("paging.gone");

/// The `batch.read` row of the derivation table.
pub const BATCH_READ: DerivationId = DerivationId::from_static("batch.read");

/// The `budget.timeout` row of the derivation table.
pub const BUDGET_TIMEOUT: DerivationId = DerivationId::from_static("budget.timeout");

/// The `deprecation.headers` row of the derivation table.
pub const DEPRECATION_HEADERS: DerivationId = DerivationId::from_static("deprecation.headers");

/// The `upstream.maturity` row of the derivation table.
pub const UPSTREAM_MATURITY: DerivationId = DerivationId::from_static("upstream.maturity");

/// The `relay.route` row of the derivation table.
pub const RELAY_ROUTE: DerivationId = DerivationId::from_static("relay.route");

/// The `api.gateway` row of the derivation table.
pub const API_GATEWAY: DerivationId = DerivationId::from_static("api.gateway");

/// The `api.service` row of the derivation table.
pub const API_SERVICE: DerivationId = DerivationId::from_static("api.service");

/// The `response.undeclared` row of the derivation table.
pub const RESPONSE_UNDECLARED: DerivationId = DerivationId::from_static("response.undeclared");

/// The `response.format` row of the derivation table.
pub const RESPONSE_FORMAT: DerivationId = DerivationId::from_static("response.format");

/// The `response.download` row of the derivation table.
pub const RESPONSE_DOWNLOAD: DerivationId = DerivationId::from_static("response.download");

/// The `redirect.location` row of the derivation table.
pub const REDIRECT_LOCATION: DerivationId = DerivationId::from_static("redirect.location");

/// The `conventions.every` row of the derivation table.
pub const CONVENTIONS_EVERY: DerivationId = DerivationId::from_static("conventions.every");

/// The `node.errors` row of the derivation table.
pub const NODE_ERRORS: DerivationId = DerivationId::from_static("node.errors");
