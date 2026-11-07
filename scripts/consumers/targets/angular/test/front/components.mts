// What the angular consumers' browser tests share: an application per test with the app's providers, a component
// mounted in it with its inputs, a reader or mutation run in its injection context, and `unmount`, which destroys
// the application and so every injector a reader was created in. The components run in JIT, without decorators.

import {
  type ApplicationRef,
  type ComponentRef,
  createComponent,
  type EnvironmentProviders,
  type Provider,
  runInInjectionContext,
  type Type,
} from "@angular/core";
import { createApplication } from "@angular/platform-browser";

export type AppProviders = readonly (Provider | EnvironmentProviders)[];

export interface Mounted<Component> {
  readonly component: ComponentRef<Component>;
  readonly application: ApplicationRef;
  unmount(): void;
}

/** Mounts `component` in a new application with `providers`, its inputs set, in a host element of the page. */
export async function mount<Component>(
  component: Type<Component>,
  providers: AppProviders,
  inputs: Readonly<Record<string, unknown>> = {},
): Promise<Mounted<Component>> {
  const application = await createApplication({ providers: [...providers] });
  const hostElement = document.body.appendChild(document.createElement("div"));
  const mounted = createComponent(component, {
    environmentInjector: application.injector,
    hostElement,
  });

  for (const [name, value] of Object.entries(inputs)) mounted.setInput(name, value);

  application.attachView(mounted.hostView);

  return {
    component: mounted,
    application,
    unmount: () => {
      application.destroy();
      hostElement.remove();
    },
  };
}

export interface RanInContext<Result> {
  readonly result: Result;
  readonly application: ApplicationRef;
  unmount(): void;
}

/** Runs `create` in the injection context of a new application with `providers`, as a field initializer does. */
export async function runInApplication<Result>(
  providers: AppProviders,
  create: () => Result,
): Promise<RanInContext<Result>> {
  const application = await createApplication({ providers: [...providers] });
  const result = runInInjectionContext(application.injector, create);

  return { result, application, unmount: () => application.destroy() };
}
