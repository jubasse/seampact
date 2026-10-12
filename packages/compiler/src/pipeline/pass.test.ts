import type { ContractIR, IrWriter } from "@seampact/spec/ir";
import { expect, test } from "vitest";
import type { PassContext, WorkspacePassContext } from "./pass.js";
import type { PassReadonly } from "./readonly.js";

type Relayed = NonNullable<ReturnType<PassContext["relayed"]>>;
type Imported = NonNullable<ReturnType<PassContext["imported"]>>;

test("a relayed draft is closed, an imported IR open", () => {
  const checks: [
    Imported extends PassReadonly<ContractIR> ? true : false,
    NonNullable<ReturnType<WorkspacePassContext["imported"]>> extends Imported ? true : false,
    // A relayed operation's access is a writer value; an imported one may be an unknown arm, so it is copied
    // only after `isKnownVariant` narrows it.
    NonNullable<Relayed["operations"][number]["access"]> extends PassReadonly<IrWriter.Access>
      ? true
      : false,
    Imported["operations"][number]["access"] extends PassReadonly<IrWriter.Access> ? false : true,
  ] = [true, true, true, true];
  expect(checks).toEqual([true, true, true, true]);
});
