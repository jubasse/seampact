package com.example.tasksservice.api;

import io.github.jubasse.seampact.springboot.runtime.ScopeResolver;

/**
 * The scope resolver of the api 'tasksService': its boundary calls the beans implementing this interface, never another api's.
 */
public interface TasksServiceScopeResolver extends ScopeResolver {
}
