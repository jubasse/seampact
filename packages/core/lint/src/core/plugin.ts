import { CORE_PLUGIN_NAME, defineCoreLintPlugin } from "../plugin.js";
import { cookieWithoutCsrf } from "./cookie-without-csrf.js";
import { credentialName } from "./credential-name.js";
import { notFoundRole } from "./not-found-role.js";
import { redundantMaturity } from "./redundant-maturity.js";
import { subtreeException } from "./subtree-exception.js";
import { unusedDeclaration } from "./unused-declaration.js";

/** The core rules, in the order of the grammar table. */
export const seampactCorePlugin = defineCoreLintPlugin({
  name: CORE_PLUGIN_NAME,
  rules: [
    subtreeException,
    cookieWithoutCsrf,
    redundantMaturity,
    credentialName,
    unusedDeclaration,
    notFoundRole,
  ],
});

/**
 * Ids the grammar table lists that no rule implements yet: the compiler refuses an unresolved output subject
 * instead of writing `always: absent`, so `seampact/field-right-unresolved` could never fire. A setting naming
 * one is accepted and has no effect until the rule ships.
 */
export const LINT_RESERVED_RULE_IDS: readonly string[] = [
  `${CORE_PLUGIN_NAME}/field-right-unresolved`,
];
