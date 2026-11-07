package com.example.consumer;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.tasks.api.spring.TasksSeampactConfiguration;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.WebApplicationContextRunner;
import org.springframework.context.annotation.Import;
import org.springframework.web.servlet.config.annotation.EnableWebMvc;

/**
 * The boot check of an app that loads one controller of the `tasks` api: without `unbound-operations` it refuses each
 * unbound operation, and a value other than `error` or `warn` is refused by name.
 */
class UnboundOperationsBootCheckTest {
    private final WebApplicationContextRunner runner = new WebApplicationContextRunner()
            .withUserConfiguration(OneControllerApp.class);

    @Test
    void byDefaultAnUnboundOperationStopsTheStart() {
        runner.run(context -> assertThat(context).getFailure()
                .hasMessageContaining("operation 'health': no handler is bound")
                .hasMessageContaining("or set seampact.tasks.unbound-operations=warn"));
    }

    @Test
    void anUnknownValueIsRefusedByName() {
        runner.withPropertyValues("seampact.tasks.unbound-operations=ignore")
                .run(context -> assertThat(context).getFailure()
                        .hasMessageContaining("'seampact.tasks.unbound-operations' is 'ignore', not 'error' or 'warn'"));
    }

    @EnableWebMvc
    @Import({TasksSeampactConfiguration.class, TasksHookDoubles.class, TasksControllers.Hooks.class})
    static final class OneControllerApp {}
}
