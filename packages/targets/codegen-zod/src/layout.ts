import type { ValidatorStyle } from "@seampact/codegen-core";

// The zod target writes the shared validators layout of `@seampact/codegen-core/validators`, each module importing
// zod first. Every export is a zod schema, so a Standard Schema v1 value.
export { SCHEMA_MODULES, SCHEMA_NAMESPACES } from "@seampact/codegen-core/validators";

export const ZOD_VALIDATOR_STYLE: ValidatorStyle = "standard-schema";

export const ZOD_IMPORT = 'import { z } from "zod";';
