### Writing the app around the boundary

- Shape the result in the handler: in the default reply mode no interceptor mapping reaches the wire.
- Log and measure in a middleware on the response's `finish` event: it sees every reply, refusals before routing included, at no interceptor-path cost.
- Type the input param with the generated input type (`@TasksNest.createTask.input() input: Tasks.CreateTaskInput`, a type-only import), so a global `ValidationPipe` with `validateCustomDecorators` finds no class to validate.
- A cache interceptor returns `undefined` from `trackBy` when `isContractRoute(context)` is true, or the boot refuses it.
- Choose `reply: interceptor` when the app's global interceptors must shape replies (`ClassSerializerInterceptor`, a response envelope): their result must still match the contract, they run inside the reply interceptor whether registered with `app.useGlobalInterceptors(...)` or as `APP_INTERCEPTOR` providers, and every route of the app, its own included, pays NestJS's interceptor path.
