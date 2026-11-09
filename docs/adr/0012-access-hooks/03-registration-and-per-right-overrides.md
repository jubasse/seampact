### Registration and per-right overrides

Each target registers hooks through its framework's own mechanism (A30): providers and a dynamic module in NestJS, options of the generated plugin in Fastify, the router factory in Express, one value passed to the generated registration in AdonisJS, container bindings later (ADR 0019), beans in Spring, service-provider bindings in Laravel, tagged services in Symfony.

- An authenticate hook is bound per identity, or one implementation declares the identities it serves.
- A decider declares the right and rule names it answers, or declares that it answers all of them.
- An override binds one implementation to one right or rule name and wins over every other decider for that name (A20, CHK-091). The others keep using the generic decider.
- Two non-override deciders claiming the same name is a boot error.
- A scope resolver is bound per scope kind, or one implementation declares the kinds it serves.
- A decider may expose a boot-time params check, called once per requirement use with the static params from the contract, to refuse values it does not understand (an unknown role name, for example).

No target ships a default hook, and nothing falls back to allow.

An app that serves several apis (a public api and a service api in one NestJS app, each with its own server target in the app config, ADR 0011) gets one boundary per api. Each api's hooks are typed from its own IR, so an identity that both apis declare through a shared file gives two authenticate interfaces, which one class may implement; each api's boot check covers that api's operations; and the generated modules, providers and route tables carry the api's name, so the two never collide.
