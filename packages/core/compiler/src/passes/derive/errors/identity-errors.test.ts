import type { IrWriter } from "@seampact/spec/ir";
import { describe, expect, test } from "vitest";
import type { DraftIR } from "../../../pipeline/seam.js";
import {
  deriveErrorsLoadFiles,
  deriveErrorsLocated,
  deriveErrorsRunContract,
} from "./test-support.js";

// An api whose `viewer` identity lists `listed` in its `errors`, guarding two routes; `ping` is public.
const identityContract = (
  listed: string,
  attachedOnRoute = "",
): string => `api: { name: shop, version: 1 }
errors:
  shop.suspended: { status: 403 }
  shop.banned: { status: 403 }
schemas:
  Viewer: { type: object, properties: { id: { type: string } } }
schemes:
  bearer: { kind: bearer }
identities:
  viewer:
    schemes: { read: [bearer], write: [bearer] }
    principal: Viewer
    errors: [${listed}]
surfaces:
  app:
    prefix: /v{version}
    identity: viewer
    routes:
      list: { method: get }
      poke: { method: post${attachedOnRoute} }
      ping: { method: get, access: { public: No credential is read here. } }
`;

function errorOf(draft: DraftIR, operationId: string, code: string) {
  return draft.operations
    .find((operation) => operation.id === operationId)
    ?.errors?.find((candidate) => candidate.code === code);
}

describe("identity errors lists", () => {
  test("each listed code reaches every route the identity guards, from its list entry", () => {
    const { diagnostics, draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": identityContract("shop.suspended, shop.banned") }),
    );

    expect(diagnostics).toEqual([]);

    for (const [index, code] of ["shop.suspended", "shop.banned"].entries())
      for (const operationId of ["list", "poke"]) {
        const entry: IrWriter.Origin = {
          layer: "api",
          pointer: `/identities/viewer/errors/${index}`,
        };

        expect(errorOf(draft, operationId, code)).toEqual({
          code,
          derivedFrom: { derivation: "identity.authenticate", from: [entry] },
          origin: entry,
        });
      }

    expect(errorOf(draft, "ping", "shop.suspended")).toBeUndefined();
  });

  test("a code also attached on a route merges, keeping the attaching node's origin", () => {
    const { diagnostics, draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({
        "api.yaml": identityContract("shop.suspended", ", errors: { shop.suspended: {} }"),
      }),
    );

    expect(diagnostics).toEqual([]);
    expect(errorOf(draft, "poke", "shop.suspended")).toEqual({
      code: "shop.suspended",
      derivedFrom: {
        derivation: "identity.authenticate",
        from: [
          { layer: "api", pointer: "/identities/viewer/errors/0" },
          { layer: "api", pointer: "/surfaces/app/routes/poke" },
        ],
      },
      origin: { layer: "api", pointer: "/surfaces/app/routes/poke" },
    });
    expect(errorOf(draft, "list", "shop.suspended")?.origin).toEqual({
      layer: "api",
      pointer: "/identities/viewer/errors/0",
    });
  });

  test("a listed code nobody declares is refused at its list entry", () => {
    const { diagnostics, draft } = deriveErrorsRunContract(
      deriveErrorsLoadFiles({ "api.yaml": identityContract("shop.suspended, shop.nope") }),
    );

    expect(diagnostics.map(deriveErrorsLocated)).toEqual([
      {
        rule: "seampact/derive/error-unknown",
        pointer: "/identities/viewer/errors/1",
        related: [],
      },
    ]);
    expect(errorOf(draft, "list", "shop.nope")).toBeUndefined();
  });
});
