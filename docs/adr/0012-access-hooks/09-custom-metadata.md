### Custom metadata

Extension values declared on rights, rules, scopes and operations (ADR 0008) are meant to reach the hook requests and the route metadata, typed from their JSON Schemas (A20): an application can, for example, attach an audit category to a right and read it in its decider. In 1.0 the extension values of a right, rule or scope do not reach the decide and resolve requests yet: a server refuses them by name (`right.extensions.unsupported`, `rule.extensions.unsupported`, `scope.extensions.unsupported`) instead of dropping them.
