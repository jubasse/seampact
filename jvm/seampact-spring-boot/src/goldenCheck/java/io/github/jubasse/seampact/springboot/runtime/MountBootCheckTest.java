package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.api.spring.Health;
import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import java.lang.reflect.Method;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * The boot check compares each contract handler's mapped path with the entry's mount followed by the contract path:
 * a framework path prefix the mount does not state (`addPathPrefix`) stops the boot, naming the prefixed path, and a
 * handler mapped under the entry's own mount passes.
 */
class MountBootCheckTest {
    private static final String CONTRACT_PATH = "/v1/health";
    private static final String PREFIXED_PATH = "/mounted" + CONTRACT_PATH;
    private static final String ENTRY_MOUNT = "/api";
    private static final JsonMapper JSON = JsonMapper.builder().build();

    @Test
    void aHandlerMappedUnderAPrefixTheMountDoesNotStateStopsTheBoot() throws NoSuchMethodException {
        IllegalStateException refused = assertThrows(IllegalStateException.class, () -> bootCheckWithHealthAt(TasksContractTable.json(), PREFIXED_PATH).afterSingletonsInstantiated());

        assertTrue(refused.getMessage().contains(mountProblem(PREFIXED_PATH)), refused.getMessage());
    }

    @Test
    void aHandlerMappedAtTheMountedContractPathPassesTheMountCheck() throws NoSuchMethodException {
        IllegalStateException refused = assertThrows(IllegalStateException.class, () -> bootCheckWithHealthAt(TasksContractTable.json(), CONTRACT_PATH).afterSingletonsInstantiated());

        assertFalse(refused.getMessage().contains("operation 'health': Spring MVC maps"), refused.getMessage());
    }

    @Test
    void aHandlerMappedUnderTheEntrysMountPassesTheMountCheck() throws NoSuchMethodException {
        String mountedTable = tableMountedAt(ENTRY_MOUNT);

        IllegalStateException refused = assertThrows(IllegalStateException.class,
                () -> bootCheckWithHealthAt(mountedTable, ENTRY_MOUNT + CONTRACT_PATH).afterSingletonsInstantiated());

        assertFalse(refused.getMessage().contains("operation 'health': Spring MVC maps"), refused.getMessage());
    }

    private static String mountProblem(String mappedPath) {
        return "operation 'health': Spring MVC maps its handler " + HealthController.class.getName() + "#health() at " + mappedPath
                + ", not at the entry's mount followed by the contract path, " + CONTRACT_PATH + "; fix: remove the path prefix the app adds"
                + " (addPathPrefix, a class-level @RequestMapping) and set the entry's mount to it.";
    }

    // The other operations have no handler and no hooks are registered, so the boot always fails; the tests read the
    // mount problem only.
    private static BootCheck bootCheckWithHealthAt(String table, String mappedPath) throws NoSuchMethodException {
        RequestMappingHandlerMapping mapping = new RequestMappingHandlerMapping();
        Method health = HealthController.class.getMethod("health");
        mapping.registerMapping(RequestMappingInfo.paths(mappedPath).methods(RequestMethod.GET).build(), new HealthController(), health);

        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("requestMappingHandlerMapping", mapping);

        return new BootCheck(new SeampactBoundary(table, new TasksSeampactBinding(), beans, new StandardEnvironment()));
    }

    // The golden table as an entry with `mount` would carry it: the generated annotations then hold the mount too.
    private static String tableMountedAt(String mount) {
        ObjectNode table = JSON.readValue(TasksContractTable.json(), ObjectNode.class);
        table.withObjectProperty("settings").put("mount", mount);

        return JSON.writeValueAsString(table);
    }

    /** A controller whose one method carries the `health` operation's composed annotation. */
    public static final class HealthController {
        @Health
        public void health() {
        }
    }
}
