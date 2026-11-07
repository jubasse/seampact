import type { ClientErrorStyle } from "../descriptors.js";
import type { Refusal } from "../refusal.js";
import type { FrontErrors } from "./operation-sources.js";

const OPTIONS_LOCATION = "";

/**
 * The client error styles a front target generates over: `errors: data` needs a client that returns its errors, and
 * a `throw`-style client is not generated over yet (ADR 0021 "Refused by name or waiting").
 */
export function refuseUnsupportedClientErrorStyle(
  errors: FrontErrors,
  errorStyle: ClientErrorStyle,
): Refusal[] {
  if (errorStyle !== "throw") return [];

  if (errors === "data") {
    return [
      {
        code: "options.errors.unsupported",
        message:
          "The option 'errors: data' returns declared errors as data, but the linked client throws them (errorStyle: throw).",
        fix: "Link a client with 'errorStyle: result', or drop 'errors: data'.",
        member: `${OPTIONS_LOCATION}/errors`,
      },
    ];
  }

  return [
    {
      code: "link.client.errorStyle.unsupported",
      message:
        "A client linked with 'errorStyle: throw' is not generated over yet: its per-operation error types are not in the client link.",
      fix: "Link a client with 'errorStyle: result' (the default); the queries still throw its declared errors as a ContractError.",
      member: "",
    },
  ];
}
