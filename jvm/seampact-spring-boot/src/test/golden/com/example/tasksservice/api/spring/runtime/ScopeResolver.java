package com.example.tasksservice.api.spring.runtime;

import io.github.jubasse.seampact.hooks.ResolveScopeHook;
import io.github.jubasse.seampact.hooks.ResolvedScope;

/** A scope resolver bean for the scope [scope] names; one bean per scope the api's operations read. */
public interface ScopeResolver extends ResolveScopeHook<ScopeCall, ResolvedScope<?, ?>, Denial> {
    String scope();
}
