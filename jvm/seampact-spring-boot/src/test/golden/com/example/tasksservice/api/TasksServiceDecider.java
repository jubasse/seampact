package com.example.tasksservice.api;

import io.github.jubasse.seampact.springboot.runtime.Decider;

/**
 * The decide hook of the api 'tasksService': its boundary calls the beans implementing this interface, never another api's.
 */
public interface TasksServiceDecider extends Decider {
}
