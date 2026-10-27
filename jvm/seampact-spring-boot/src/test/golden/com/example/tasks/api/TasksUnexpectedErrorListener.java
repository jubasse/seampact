package com.example.tasks.api;

import io.github.jubasse.seampact.springboot.runtime.UnexpectedErrorListener;

/**
 * The unexpected-error listener of the api 'tasks': its boundary calls the beans implementing this interface, never another api's.
 */
public interface TasksUnexpectedErrorListener extends UnexpectedErrorListener {
}
