### 16. Seeing an operation whole: `seampact explain`

One fact, one place, has a price: what a route requires and answers is spread over the tree on purpose. `updateTask` takes its identity from the surface, its scope from `channels`, its version from `tasks`, its codes from the conventions, the rights and the derivations, and only the compiler sees the whole. `seampact explain <api>.<operationId>` prints it. It compiles the workspace like `compile`, then writes the operation from the IR as YAML in the grammar's own words, each line commented with where it came from: the derivation that produced it (ADR 0006 section 5) and the file and line of the declaration or node that caused it, read through the side table (ADR 0004 section 11). The api name may be left out when the workspace has one api.

```yaml
# seampact explain tasks.updateTask
operationId: updateTask                          # ops.update, tasks/api.yaml:51
method: patch                                    # the default of the update op
path: /v1/channels/{channelId}/tasks/{taskId}
identity: user                                   # surfaces.app, tasks/api.yaml:23
schemes: [sessionCookie, bearer]                 # identities.user.schemes.write, shared/base.yaml:24
csrf: X-Csrf-Token                               # csrf.cookieWrite, schemes.sessionCookie, shared/base.yaml:3
scopes: { channel: path.channelId }              # channels.member, tasks/api.yaml:35
requires:
  - { right: tasks.update, subject: path.taskId }   # tasks/api.yaml:53; the subject defaults to the member id
input: UpdateTask                                # tasks/api.yaml:52; concurrency.version adds expectedVersion
concurrency: { version: body.expectedVersion, field: version }   # tasks, tasks/api.yaml:41
headers: { Idempotency-Key: required }           # idempotency.write, shared/base.yaml:91
errors:
  - { status: 400, code: api.schema_invalid }    # input.invalid, idempotency.write; bound at shared/base.yaml:100
  - { status: 401, code: api.unauthenticated }   # identity.authenticate; the role's default code
  - { status: 403, code: api.csrf_invalid }      # csrf.cookieWrite; the role's default code
  - { status: 403, code: api.forbidden }         # requirement.errors, rights.tasks.update, shared/base.yaml:49
  - { status: 404, code: api.not_found }         # member.notFound for path.taskId; requirement.errors; scope.errors, scopes.channel, shared/base.yaml:39
  - { status: 409, code: state.conflict }        # concurrency.version
  # and the idempotency 409 and 422, 413, 415, and 500 api.internal from conventions.errors.every
```

The output is a view, never an input: it is not a contract file, and nothing reads it back. It is deterministic, so two runs diff cleanly in review, while `seampact diff` still classifies the change (ADR 0005). It needs no new IR member: every element already carries `origin` or `derivedFrom` (ADR 0004 section 6).
