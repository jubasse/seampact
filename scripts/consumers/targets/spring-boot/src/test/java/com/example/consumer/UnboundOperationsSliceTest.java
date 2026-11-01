package com.example.consumer;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.hamcrest.Matchers.containsString;

import com.example.tasks.api.spring.TasksSeampactConfiguration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.webmvc.test.autoconfigure.WebMvcTest;
import org.springframework.context.annotation.Import;
import org.springframework.test.annotation.DirtiesContext;
import org.springframework.test.annotation.DirtiesContext.ClassMode;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * A `@WebMvcTest` slice that loads one controller of the `tasks` api starts under
 * `seampact.tasks.unbound-operations=warn`: the operations it leaves unbound are logged once and their routes answer
 * the api's 404, while a bound route still goes through the boundary. The class loads its own context, so the boot
 * check's log line falls in its captured output whatever context another class cached first.
 */
@WebMvcTest(controllers = TasksControllers.Hooks.class)
@Import({TasksSeampactConfiguration.class, TasksHookDoubles.class})
@TestPropertySource(properties = "seampact.tasks.unbound-operations=warn")
@ExtendWith(OutputCaptureExtension.class)
@DirtiesContext(classMode = ClassMode.BEFORE_CLASS)
class UnboundOperationsSliceTest {
    private static final String UNBOUND_LINE = "seampact: api 'tasks' serves no handler for";

    @Autowired
    private MockMvc mockMvc;

    @Test
    void anUnboundOperationsRouteAnswersTheApisNotFound(CapturedOutput output) throws Exception {
        mockMvc.perform(get("/v1/health"))
                .andExpect(status().isNotFound())
                .andExpect(content().string(containsString("api.not_found")));

        assertEquals(1, output.getAll().split(UNBOUND_LINE, -1).length - 1, output.getAll());
    }

    @Test
    void aBoundRouteStillGoesThroughTheBoundary() throws Exception {
        mockMvc.perform(post("/v1/hooks/payments"))
                .andExpect(status().isUnauthorized())
                .andExpect(content().string(containsString("\"code\":\"api.")));
    }
}
