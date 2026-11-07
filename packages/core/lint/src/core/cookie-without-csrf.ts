import { isKnownVariant } from "@seampact/spec/ir";
import type { LintRuleDefinition } from "../plugin.js";
import { lintOwnsOrigin } from "./origins.js";

export const cookieWithoutCsrf: LintRuleDefinition = {
  name: "cookie-without-csrf",
  defaultSeverity: "warning",
  reports: "a cookie scheme without `csrf` (section 9)",
  silencedOn: "the scheme",
  check({ ir, report }) {
    for (const scheme of Object.values(ir.schemes)) {
      if (!isKnownVariant("Scheme", scheme) || scheme.kind !== "cookie") continue;

      if (scheme.csrf !== undefined || !lintOwnsOrigin(scheme.origin)) continue;
      report({
        message: `The cookie scheme '${scheme.id}' has no csrf, so no CSRF check is derived for the routes it reaches.`,
        fix: `Add csrf: <header scheme> to '${scheme.id}', or allow seampact/cookie-without-csrf on it with a reason.`,
        origin: scheme.origin,
        allowAt: [scheme.origin],
      });
    }
  },
};
