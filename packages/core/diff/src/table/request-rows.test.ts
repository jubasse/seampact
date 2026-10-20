import {
  type ContractIR,
  type DerivedIdempotency,
  type IdentityAccess,
  isKnownVariant,
  type Param,
} from "@seampact/spec/ir";
import { goldenIr, operationOf } from "../test-support.js";
import { type RowCase, testRowCases } from "./row-case.test-support.js";

// The request rows: params, bodies, access, rights and rules, CSRF, idempotency, concurrency and paging, each a
// reference IR pair. createTask is guarded by the `user` identity, requires `throttle` (bucket `write`) and
// `roles`, is idempotent and CSRF protected; updateTask holds a concurrency check; listTasks is paged by `cursor`.

const ORIGIN = { layer: "api" as const, pointer: "/test" };

function headerParam(ir: ContractIR, operation: string, name: string): Param {
  const param = operationOf(ir, operation).params.header.find(
    (candidate) => candidate.name === name,
  );

  if (param === undefined) throw new Error(`no header param ${name} on ${operation}`);

  return param;
}

function addQueryParam(ir: ContractIR): void {
  operationOf(ir, "listTasks").params.query.push({
    name: "label",
    type: { kind: "array", items: { kind: "scalar", type: "string", refinements: {} } },
    required: false,
    wire: { kind: "list", style: "form", explode: true, brackets: false },
    origin: ORIGIN,
  });
}

function createIdempotency(ir: ContractIR): DerivedIdempotency {
  const idempotency = operationOf(ir, "createTask").idempotency;

  if (
    idempotency === undefined ||
    !isKnownVariant("Idempotency", idempotency) ||
    idempotency.kind !== "derived"
  )
    throw new Error("createTask is not idempotent");

  return idempotency;
}

function getTaskAccess(ir: ContractIR): IdentityAccess {
  const access = operationOf(ir, "getTask").access;

  if (!isKnownVariant("Access", access) || access.kind !== "identity")
    throw new Error("getTask is not identity guarded");

  return access;
}

function listPaging(ir: ContractIR) {
  const paging = operationOf(ir, "listTasks").paging;

  if (paging === undefined) throw new Error("listTasks is not paged");

  return paging;
}

const ROW_CASES: RowCase[] = [
  {
    kind: "param.required",
    case: "optionalToRequired",
    position: "input",
    expected: "C",
    after: (ir) => {
      headerParam(ir, "searchTasks", "Authorization").required = true;
    },
  },
  {
    kind: "param.required",
    case: "requiredToOptional",
    position: "input",
    expected: "S",
    base: (ir) => {
      headerParam(ir, "searchTasks", "Authorization").required = true;
    },
    after: (ir) => {
      headerParam(ir, "searchTasks", "Authorization").required = false;
    },
  },
  {
    kind: "type.changed",
    case: "wire",
    position: "input",
    expected: "CS",
    base: addQueryParam,
    after: (ir) => {
      const [param] = operationOf(ir, "listTasks").params.query;

      if (param?.wire !== undefined) param.wire.explode = false;
    },
  },
  {
    kind: "unknownQuery",
    case: "ignored",
    position: "input",
    expected: "-",
    after: (ir) => {
      operationOf(ir, "listTasks").unknownQuery = {
        policy: "ignore",
        reason: "tracking keys",
        origin: ORIGIN,
      };
    },
  },
  {
    kind: "unknownQuery",
    case: "refused",
    position: "input",
    expected: "C",
    base: (ir) => {
      operationOf(ir, "listTasks").unknownQuery = {
        policy: "ignore",
        reason: "tracking keys",
        origin: ORIGIN,
      };
    },
    after: (ir) => {
      operationOf(ir, "listTasks").unknownQuery = { policy: "refuse" };
    },
  },
  {
    kind: "refinement",
    case: "tightened",
    position: "input",
    expected: "C",
    note: " for a lower body limit",
    pointerFragment: "/input/bodyLimitBytes",
    after: (ir) => {
      const input = operationOf(ir, "createTask").input;

      if (input !== undefined) input.bodyLimitBytes = 1024;
    },
  },
  {
    kind: "body",
    case: "rawBody",
    position: "input",
    expected: "S",
    after: (ir) => {
      const input = operationOf(ir, "createTask").input;

      if (input !== undefined) input.rawBody = true;
    },
  },
  {
    kind: "proof",
    case: "removed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const input = operationOf(ir, "purgeTask").input;

      if (input !== undefined) input.proofs = [];
    },
  },
  {
    kind: "proof",
    case: "added",
    position: "input",
    expected: "C",
    base: (ir) => {
      const input = operationOf(ir, "purgeTask").input;

      if (input !== undefined) input.proofs = [];
    },
    after: (ir) => {
      const input = operationOf(ir, "purgeTask").input;
      const proofs = operationOf(goldenIr(), "purgeTask").input?.proofs;

      if (input !== undefined && proofs !== undefined) input.proofs = proofs;
    },
  },
  {
    kind: "access",
    case: "loosened",
    position: "input",
    expected: "S",
    after: (ir) => {
      operationOf(ir, "getTask").access = { kind: "public", reason: "open data", origin: ORIGIN };
    },
  },
  {
    kind: "access",
    case: "tightened",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "health").access = {
        kind: "identity",
        identity: "user",
        schemes: ["bearer"],
        origin: ORIGIN,
      };
    },
  },
  {
    kind: "access",
    case: "schemeRemoved",
    position: "input",
    expected: "C",
    after: (ir) => {
      getTaskAccess(ir).schemes = ["bearer"];
    },
  },
  {
    kind: "access",
    case: "schemeAdded",
    position: "input",
    expected: "-",
    after: (ir) => {
      getTaskAccess(ir).schemes.push("internalToken");
    },
  },
  {
    kind: "access",
    case: "identity",
    position: "input",
    expected: "CS",
    after: (ir) => {
      getTaskAccess(ir).identity = "service";
    },
  },
  {
    kind: "callerKind",
    case: "added",
    position: "input",
    expected: "S",
    after: (ir) => {
      operationOf(ir, "getTask").callerKinds.push("anonymous");
    },
  },
  {
    kind: "callerKind",
    case: "removed",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").callerKinds = [];
    },
  },
  {
    kind: "principalRequirement",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").principalRequires.push({ field: "emailVerified", origin: ORIGIN });
    },
  },
  {
    kind: "principalRequirement",
    case: "removed",
    position: "input",
    expected: "S",
    base: (ir) => {
      operationOf(ir, "getTask").principalRequires.push({ field: "emailVerified", origin: ORIGIN });
    },
    after: (ir) => {
      operationOf(ir, "getTask").principalRequires = [];
    },
  },
  {
    kind: "scope",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      operationOf(ir, "getTask").scopes = [];
    },
  },
  {
    kind: "scope",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getDraft").scopes.push({
        scope: "channel",
        source: { in: "query", name: "channelId" },
        origin: ORIGIN,
      });
    },
  },
  {
    kind: "scope",
    case: "changed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const [scope] = operationOf(ir, "getTask").scopes;

      if (scope !== undefined) scope.source = { in: "header", name: "X-Channel" };
    },
  },
  {
    kind: "requirement",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").requires.push({ kind: "right", right: "tasks.read" });
    },
  },
  {
    kind: "requirement",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      operationOf(ir, "createTask").requires.pop();
    },
  },
  {
    kind: "requirement",
    case: "changed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const roles = operationOf(ir, "createTask").requires[1];

      if (roles !== undefined && isKnownVariant("Requirement", roles) && roles.kind === "right")
        roles.params = { allowed: ["owner"] };
    },
  },
  {
    kind: "order",
    case: "requires",
    position: "input",
    expected: "info",
    after: (ir) => {
      operationOf(ir, "createTask").requires.reverse();
    },
  },
  {
    kind: "binding",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").bindings.push({
        from: { in: "principal", name: "userId" },
        to: { in: "query", name: "owner" },
        origin: ORIGIN,
      });
    },
  },
  {
    kind: "binding",
    case: "changed",
    position: "input",
    expected: "CS",
    base: (ir) => {
      operationOf(ir, "getTask").bindings.push({
        from: { in: "principal", name: "userId" },
        to: { in: "query", name: "owner" },
        origin: ORIGIN,
      });
    },
    after: (ir) => {
      const [binding] = operationOf(ir, "getTask").bindings;

      if (binding !== undefined) binding.from = { in: "principal", name: "teamId" };
    },
  },
  {
    kind: "fieldRight",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      const operation = operationOf(ir, "createTask");

      operation.fieldRights = operation.fieldRights.filter((right) => right.direction !== "input");
    },
  },
  {
    kind: "fieldRight",
    case: "changed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const right = operationOf(ir, "createTask").fieldRights.find(
        (candidate) => candidate.direction === "input",
      );

      if (right !== undefined) right.inputPolicy = "strip";
    },
  },
  {
    kind: "csrf",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      operationOf(ir, "createTask").csrf = { kind: "exempt", reason: "token auth", origin: ORIGIN };
    },
  },
  {
    kind: "csrf",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").csrf = {
        kind: "derived",
        header: "X-Csrf-Token",
        derivedFrom: { derivation: "csrf.cookieWrite", from: [ORIGIN] },
      };
    },
  },
  {
    kind: "csrf",
    case: "changed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const csrf = operationOf(ir, "createTask").csrf;

      if (csrf !== undefined && isKnownVariant("Csrf", csrf) && csrf.kind === "derived")
        csrf.header = "X-Xsrf";
    },
  },
  {
    kind: "owner",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      delete operationOf(ir, "getDraft").owner;
    },
  },
  {
    kind: "owner",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "getTask").owner = { kind: "caller", origin: ORIGIN };
    },
  },
  {
    kind: "idempotency",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      delete operationOf(ir, "createTask").idempotency;
    },
  },
  {
    kind: "idempotency",
    case: "addedRequired",
    position: "input",
    expected: "C",
    after: (ir) => {
      operationOf(ir, "searchTasks").idempotency = structuredClone(createIdempotency(ir));
    },
  },
  {
    kind: "idempotency",
    case: "addedOptional",
    position: "input",
    expected: "-",
    after: (ir) => {
      const idempotency = structuredClone(createIdempotency(ir));

      idempotency.required = false;
      operationOf(ir, "searchTasks").idempotency = idempotency;
    },
  },
  {
    kind: "idempotency",
    case: "requiredToOptional",
    position: "input",
    expected: "S",
    after: (ir) => {
      createIdempotency(ir).required = false;
    },
  },
  {
    kind: "idempotency",
    case: "optionalToRequired",
    position: "input",
    expected: "C",
    base: (ir) => {
      createIdempotency(ir).required = false;
    },
    after: (ir) => {
      createIdempotency(ir).required = true;
    },
  },
  {
    kind: "idempotency",
    case: "header",
    position: "input",
    expected: "CS",
    after: (ir) => {
      createIdempotency(ir).header = "X-Request-Id";
    },
  },
  {
    kind: "idempotency",
    case: "replayHeader",
    position: "output",
    expected: "C",
    after: (ir) => {
      createIdempotency(ir).replayHeader = "X-Replayed";
    },
  },
  {
    kind: "idempotency",
    case: "lifetimeShortened",
    position: "input",
    expected: "S",
    after: (ir) => {
      createIdempotency(ir).lifetimeMs = 60000;
    },
  },
  {
    kind: "idempotency",
    case: "lifetimeLengthened",
    position: "input",
    expected: "-",
    after: (ir) => {
      createIdempotency(ir).lifetimeMs *= 2;
    },
  },
  {
    kind: "idempotency",
    case: "enforceDropped",
    position: "input",
    expected: "S",
    after: (ir) => {
      createIdempotency(ir).enforce = "none";
    },
  },
  {
    kind: "idempotency",
    case: "enforceAdded",
    position: "input",
    expected: "-",
    base: (ir) => {
      createIdempotency(ir).enforce = "none";
    },
    after: (ir) => {
      createIdempotency(ir).enforce = "boundary";
    },
  },
  {
    kind: "concurrency",
    case: "removed",
    position: "input",
    expected: "S",
    after: (ir) => {
      delete operationOf(ir, "updateTask").concurrency;
    },
  },
  {
    kind: "concurrency",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      const concurrency = operationOf(ir, "updateTask").concurrency;

      if (concurrency !== undefined)
        operationOf(ir, "assignTask").concurrency = structuredClone(concurrency);
    },
  },
  {
    kind: "concurrency",
    case: "changed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const concurrency = operationOf(ir, "updateTask").concurrency;

      if (concurrency !== undefined) concurrency.version = { in: "header", name: "If-Match" };
    },
  },
  {
    kind: "paging",
    case: "removed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      delete operationOf(ir, "listTasks").paging;
    },
  },
  {
    kind: "paging",
    case: "added",
    position: "input",
    expected: "CS",
    after: (ir) => {
      operationOf(ir, "getTasksBatch").paging = structuredClone(listPaging(ir));
    },
  },
  {
    kind: "paging",
    case: "token",
    position: "input",
    expected: "CS",
    after: (ir) => {
      listPaging(ir).token = "instant";
    },
  },
  {
    kind: "paging",
    case: "defaultLimit",
    position: "input",
    expected: "CS",
    after: (ir) => {
      listPaging(ir).defaultLimit = 20;
    },
  },
  {
    kind: "refinement",
    case: "loosened",
    position: "input",
    expected: "S",
    note: " for a higher page limit",
    pointerFragment: "/paging/maxLimit",
    after: (ir) => {
      listPaging(ir).maxLimit = 100;
    },
  },
  {
    kind: "paging",
    case: "overLimitClamped",
    position: "input",
    expected: "-",
    after: (ir) => {
      listPaging(ir).overLimit = "clamp";
    },
  },
  {
    kind: "paging",
    case: "overLimitRejected",
    position: "input",
    expected: "C",
    base: (ir) => {
      listPaging(ir).overLimit = "clamp";
    },
    after: (ir) => {
      listPaging(ir).overLimit = "reject";
    },
  },
  {
    kind: "paging",
    case: "sortKeyAdded",
    position: "input",
    expected: "S",
    after: (ir) => {
      listPaging(ir).sortKeys.push({ key: "title", origin: ORIGIN });
    },
  },
  {
    kind: "paging",
    case: "sortKeyRemoved",
    position: "input",
    expected: "C",
    after: (ir) => {
      listPaging(ir).sortKeys = [];
    },
  },
  {
    kind: "paging",
    case: "sortKeyChanged",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const [sortKey] = listPaging(ir).sortKeys;

      if (sortKey !== undefined) sortKey.right = "tasks.read";
    },
  },
  {
    kind: "operation.route",
    case: "safe",
    position: "none",
    expected: "CS",
    after: (ir) => {
      operationOf(ir, "searchTasks").safe = !operationOf(ir, "searchTasks").safe;
    },
  },
  {
    kind: "binding",
    case: "removed",
    position: "input",
    expected: "S",
    base: (ir) => {
      operationOf(ir, "getTask").bindings.push({
        from: { in: "principal", name: "userId" },
        to: { in: "query", name: "owner" },
        origin: ORIGIN,
      });
    },
    after: (ir) => {
      operationOf(ir, "getTask").bindings = [];
    },
  },
  {
    kind: "fieldRight",
    case: "added",
    position: "input",
    expected: "C",
    after: (ir) => {
      const right = operationOf(ir, "createTask").fieldRights.find(
        (candidate) => candidate.direction === "input",
      );

      if (right !== undefined)
        operationOf(ir, "createTask").fieldRights.push({ ...right, pointer: "/title" });
    },
  },
  {
    kind: "owner",
    case: "changed",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const owner = operationOf(ir, "getDraft").owner;

      if (owner !== undefined) owner.kind = "team";
    },
  },
  {
    kind: "paging",
    case: "style",
    position: "input",
    expected: "CS",
    after: (ir) => {
      const cursor = ir.pagings.cursor;

      if (cursor !== undefined) ir.pagings.offset = { ...structuredClone(cursor), id: "offset" };
      listPaging(ir).style = "offset";
    },
  },
];

testRowCases("the request rows", ROW_CASES);
