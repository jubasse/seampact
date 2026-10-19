import type { ValidatorStyle } from "@seampact/codegen-core";

// The yup target writes the shared validators layout of `@seampact/codegen-core/validators`, each module importing
// yup first. Every export is a yup schema or a Standard Schema over one, so a Standard Schema v1 value.
export { SCHEMA_MODULES, SCHEMA_NAMESPACES } from "@seampact/codegen-core/validators";

export const YUP_VALIDATOR_STYLE: ValidatorStyle = "standard-schema";

export const YUP_IMPORT = 'import * as yup from "yup";';
