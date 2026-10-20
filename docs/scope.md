# What seampact does not do

- Generate business logic, persistence, an authentication check or an authorization decision.
- Provide a server framework, or a TypeScript API to write contracts: YAML is the only way to declare one. An importer from an existing OpenAPI document is planned for v3.
- Impose right names, roles, a permission model, a tenancy scheme, a wire format or a code style.
- Model WebSocket, Server-Sent Events, gRPC or GraphQL. The IR leaves room for them; see [ADR 0014](adr/0014-room-for-real-time-and-rpc.md).
