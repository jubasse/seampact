// What the vue consumers' browser tests share: a composable run in the setup of a mounted component, so it has the
// component's scope and injection context, and the scope disposed when the test unmounts it.

import { render } from "vitest-browser-vue";
import { defineComponent, h, type Plugin } from "vue";

export interface RenderedComposable<Result> {
  readonly result: Result;
  unmount(): Promise<void>;
}

/** Runs `composable` in the setup of a mounted component, with the app plugins given. */
export async function renderComposable<Result>(
  composable: () => Result,
  plugins: readonly Plugin[] = [],
): Promise<RenderedComposable<Result>> {
  const results: Result[] = [];
  const Probe = defineComponent(() => {
    results.push(composable());

    return () => h("div");
  });
  const view = await render(Probe, { global: { plugins: [...plugins] } });
  const [result] = results;

  if (result === undefined)
    throw new Error("vue: the composable's component did not run its setup.");

  return { result, unmount: () => view.unmount() };
}
