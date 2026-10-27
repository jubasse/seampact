package io.github.jubasse.seampact.springboot.runtime;

import io.github.jubasse.seampact.hooks.ResolveScopeHook;
import io.github.jubasse.seampact.hooks.ResolvedScope;

/**
 * A scope resolver for the scope [scope] names: the app's bean implements the `<Api>ScopeResolver` its api generates,
 * one bean per scope the api's operations read.
 */
public interface ScopeResolver extends ResolveScopeHook<ScopeCall, ResolvedScope<?, ?>, Denial> {
    String scope();
}
