package com.example.optins.api;

import io.github.jubasse.seampact.springboot.runtime.UnexpectedErrorListener;

/**
 * The unexpected-error listener of the api 'tasksService': its boundary calls the beans implementing this interface, never another api's.
 */
public interface TasksServiceUnexpectedErrorListener extends UnexpectedErrorListener {
}
