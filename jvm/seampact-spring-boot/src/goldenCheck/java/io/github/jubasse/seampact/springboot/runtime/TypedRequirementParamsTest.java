package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.example.tasks.api.schemas.ReauthIntent;
import com.example.tasks.api.schemas.RecentAuthParams;
import com.example.tasks.api.schemas.Role;
import com.example.tasks.api.schemas.RolesParams;
import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import io.github.jubasse.seampact.hooks.RequirementKind;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import tools.jackson.databind.JsonNode;

/**
 * The params a decider receives on the golden reference api: each use site's values as the generated params record of
 * its right or rule, and none for a right that declares no params.
 */
class TypedRequirementParamsTest {
    private static final String RIGHT_KIND = "right";
    private static final String RULE_KIND = "rule";

    private final SeampactBoundary boundary =
            new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), new StaticListableBeanFactory(), new StandardEnvironment());

    @Test
    void theDecideRequestOfARightCarriesItsGeneratedParamsRecord() {
        Optional<Object> params = RequirementParams.of(boundary, RequirementKind.RIGHT, "roles", useSite("assignTask", RIGHT_KIND, "roles"));

        assertEquals(Optional.of(new RolesParams(List.of(Role.OWNER, Role.EDITOR))), params);
    }

    @Test
    void theDecideRequestOfARuleCarriesItsGeneratedParamsRecord() {
        Optional<Object> params = RequirementParams.of(boundary, RequirementKind.RULE, "recentAuth", useSite("purgeTask", RULE_KIND, "recentAuth"));

        assertEquals(Optional.of(new RecentAuthParams(ReauthIntent.PURGE_TASK)), params);
    }

    @Test
    void theDecideRequestOfARightWithoutParamsCarriesNone() {
        Optional<Object> params = RequirementParams.of(boundary, RequirementKind.RIGHT, "tasks.read", useSite("searchTasks", RIGHT_KIND, "tasks.read"));

        assertTrue(params.isEmpty(), "a right without params gives no params: " + params);
    }

    /** The requirement `name` of kind `kind` that the golden table's operation `operationId` asks. */
    private JsonNode useSite(String operationId, String kind, String name) {
        ContractRoute route = boundary.table().routes().stream().filter(candidate -> candidate.id().equals(operationId)).findFirst().orElseThrow();

        for (JsonNode requirement : route.operation().path("requires")) {
            if (requirement.path("kind").asString().equals(kind) && requirement.path(kind).asString().equals(name)) return requirement;
        }

        throw new IllegalStateException("the golden operation '" + operationId + "' asks no " + kind + " '" + name + "'");
    }
}
