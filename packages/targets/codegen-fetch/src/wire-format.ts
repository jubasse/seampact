import {
  below,
  type IrLocation,
  type Refusal,
  refuseNotGeneratedYet,
} from "@seampact/codegen-core";
import type { Template, WireFormat } from "@seampact/spec/ir";

const CODE_SLOT = "code";
const PARAMS_MERGE = "params";
const PROBLEM_MEDIA: readonly string[] = ["application/problem+json", "application/json"];

// A wire format the client reads: no `$meta` yet, and errors are a JSON object carrying the code with the code's
// params merged in. Success bodies and headers are read per response (success-reader.ts).
export function refuseFormatForms(format: WireFormat): Refusal[] {
  const location = below({ member: "" }, "formats", format.id);
  const refusals: Refusal[] = [];

  if (Object.keys(format.meta).length > 0) {
    refusals.push(
      refuseNotGeneratedYet("format.meta", "A format `$meta`", below(location, "meta")),
    );
  }

  refuseErrorShape(format, below(location, "error"), refusals);

  return refusals;
}

function refuseErrorShape(format: WireFormat, location: IrLocation, refusals: Refusal[]): void {
  const { error } = format;

  if (!PROBLEM_MEDIA.includes(error.media)) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.media",
        `A '${error.media}' error body`,
        below(location, "media"),
      ),
    );
  }

  if (error.headers.length > 0) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.headers",
        "An error header written by the format",
        below(location, "headers"),
      ),
    );
  }

  if (!carriesCodeWithMergedParams(error.body)) {
    refusals.push(
      refuseNotGeneratedYet(
        "format.error.body",
        "An error body without a top-level `code` member and merged params",
        below(location, "body"),
      ),
    );
  }
}

function isWholeSlot(template: Template, slot: string): boolean {
  return (
    template.kind === "slot" &&
    "slot" in template &&
    template.slot === slot &&
    template.path.length === 0
  );
}

function carriesCodeWithMergedParams(body: Template): boolean {
  if (body.kind !== "object" || !("members" in body)) return false;

  const hasCode = body.members.some(
    (member) =>
      member.name.kind === "text" &&
      "text" in member.name &&
      member.name.text === CODE_SLOT &&
      isWholeSlot(member.value, CODE_SLOT),
  );

  return hasCode && body.merge === PARAMS_MERGE;
}
