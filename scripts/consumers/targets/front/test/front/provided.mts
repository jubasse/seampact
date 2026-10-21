// What the front Vitest config provides to the browser tests: the URL of the server it started, which the page
// reaches through the same-origin proxy, its control routes, and the credentials the template's hooks honour.
declare module "vitest" {
  export interface ProvidedContext {
    serverBaseUrl: string;
    controlRoutes: { script: string; hookCalls: string };
    userToken: string;
    throttledUserToken: string;
    throttleRetryAfterMs: number;
  }
}

export {};
