// Compile-time checks of the generated ContractException: a declared code takes its params, any other code is refused.
import * as TasksNest from "../generated/server/tasks/index.js";

export const declaredWithoutParams = new TasksNest.ContractException("api.not_found");

// @ts-expect-error no operation of the api declares this code
export const undeclaredCode = new TasksNest.ContractException("api.unknown");

// @ts-expect-error the code declares params
export const missingParams = new TasksNest.ContractException("api.schema_invalid");
