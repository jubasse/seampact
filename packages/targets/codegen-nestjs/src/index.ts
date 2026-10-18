// The NestJS server target: the boundary around the app's controllers for each api, placing the shared Node
// request checks of codegen-core in NestJS's middleware, guard, interceptor and filter, validating with zod.
export { target } from "./target.js";
