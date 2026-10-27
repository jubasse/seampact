package com.example.tasks.api;

import io.github.jubasse.seampact.springboot.runtime.Decider;

/**
 * The decide hook of the api 'tasks': its boundary calls the beans implementing this interface, never another api's.
 */
public interface TasksDecider extends Decider {
}
