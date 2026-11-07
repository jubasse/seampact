// The angular consumers' components are compiled in the page by Angular's JIT compiler, with no decorator syntax and
// no Angular build step: `jitComponent` applies `@Component` as a call and marks each `input()` field as the Angular
// CLI's JIT transform does, since the JIT compiler reads no class field by itself.
import "@angular/compiler";
import { Component, Input, type Type } from "@angular/core";

/** Compiles `component` with `metadata`, its `signalInputs` fields read as signal inputs under their own names. */
export function jitComponent<Instance>(
  component: Type<Instance>,
  metadata: Component,
  signalInputs: readonly string[] = [],
): Type<Instance> {
  for (const name of signalInputs) {
    const signalInput = { alias: name, required: false, isSignal: true };

    Input(signalInput)(component.prototype, name);
  }

  Component(metadata)(component);

  return component;
}
