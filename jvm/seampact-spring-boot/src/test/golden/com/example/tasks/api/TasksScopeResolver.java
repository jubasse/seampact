package com.example.tasks.api;

import io.github.jubasse.seampact.springboot.runtime.ScopeResolver;

/**
 * The scope resolver of the api 'tasks': its boundary calls the beans implementing this interface, never another api's.
 */
public interface TasksScopeResolver extends ScopeResolver {
}
