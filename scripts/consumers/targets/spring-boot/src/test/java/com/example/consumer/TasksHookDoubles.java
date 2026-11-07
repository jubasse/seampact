package com.example.consumer;

import org.springframework.context.annotation.Import;

/**
 * The `tasks` api's hook beans, for a test that loads only some of the app: the boot check needs every hook the
 * contract names, whichever controllers the test loads. Not a component, so the full app's scan never registers it.
 */
@Import({
    TasksHooks.UserHook.class,
    TasksHooks.ScriptedDecider.class,
    TasksHooks.OverriddenRightDecider.class,
    TasksHooks.ChannelResolver.class,
    TasksHooks.TasksUnexpectedErrors.class,
    StripeHook.class,
    MemoryIdempotencyStore.class
})
final class TasksHookDoubles {}
