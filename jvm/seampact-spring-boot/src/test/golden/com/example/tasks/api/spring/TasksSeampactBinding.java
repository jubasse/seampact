package com.example.tasks.api.spring;

import com.example.tasks.api.DeleteDraftErrors;
import com.example.tasks.api.DeleteDraftInput;
import com.example.tasks.api.DeleteDraftResult;
import com.example.tasks.api.GetChannelErrors;
import com.example.tasks.api.GetChannelInput;
import com.example.tasks.api.GetChannelResult;
import com.example.tasks.api.GetDraftErrors;
import com.example.tasks.api.GetDraftInput;
import com.example.tasks.api.GetDraftResult;
import com.example.tasks.api.GetTaskErrors;
import com.example.tasks.api.GetTaskInput;
import com.example.tasks.api.GetTaskResult;
import com.example.tasks.api.GetTasksBatchErrors;
import com.example.tasks.api.GetTasksBatchInput;
import com.example.tasks.api.GetTasksBatchResult;
import com.example.tasks.api.HealthErrors;
import com.example.tasks.api.HealthInput;
import com.example.tasks.api.HealthResult;
import com.example.tasks.api.ListChannelsErrors;
import com.example.tasks.api.ListChannelsInput;
import com.example.tasks.api.ListChannelsResult;
import com.example.tasks.api.ListTasksErrors;
import com.example.tasks.api.ListTasksInput;
import com.example.tasks.api.ListTasksResult;
import com.example.tasks.api.SearchTasksErrors;
import com.example.tasks.api.SearchTasksInput;
import com.example.tasks.api.SearchTasksResult;
import com.example.tasks.api.TasksContractException;
import com.example.tasks.api.UserAuthenticateHook;
import com.example.tasks.api.UserAuthenticateRequest;
import com.example.tasks.api.UserCredentials;
import com.example.tasks.api.spring.runtime.ApiBinding;
import com.example.tasks.api.spring.runtime.Denial;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import java.lang.annotation.Annotation;
import java.util.Map;
import java.util.Optional;
import org.springframework.beans.factory.ListableBeanFactory;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The Java types of the api 'tasks' its boundary runtime reads.
 */
public final class TasksSeampactBinding implements ApiBinding {
    @Override
    public Map<String, Class<?>> inputTypes() {
        return Map.ofEntries(
        Map.entry("deleteDraft", DeleteDraftInput.class),
        Map.entry("getChannel", GetChannelInput.class),
        Map.entry("getDraft", GetDraftInput.class),
        Map.entry("getTask", GetTaskInput.class),
        Map.entry("getTasksBatch", GetTasksBatchInput.class),
        Map.entry("health", HealthInput.class),
        Map.entry("listChannels", ListChannelsInput.class),
        Map.entry("listTasks", ListTasksInput.class),
        Map.entry("searchTasks", SearchTasksInput.class));
    }

    @Override
    public Map<String, Class<? extends Annotation>> annotations() {
        return Map.ofEntries(
        Map.entry("deleteDraft", DeleteDraft.class),
        Map.entry("getChannel", GetChannel.class),
        Map.entry("getDraft", GetDraft.class),
        Map.entry("getTask", GetTask.class),
        Map.entry("getTasksBatch", GetTasksBatch.class),
        Map.entry("health", Health.class),
        Map.entry("listChannels", ListChannels.class),
        Map.entry("listTasks", ListTasks.class),
        Map.entry("searchTasks", SearchTasks.class));
    }

    @Override
    public Map<Class<?>, Integer> successArms() {
        return Map.ofEntries(
        Map.entry(DeleteDraftResult.Status200.class, 200),
        Map.entry(GetChannelResult.Status200.class, 200),
        Map.entry(GetDraftResult.Status200.class, 200),
        Map.entry(GetTaskResult.Status200.class, 200),
        Map.entry(GetTasksBatchResult.Status200.class, 200),
        Map.entry(HealthResult.Status200.class, 200),
        Map.entry(ListChannelsResult.Status200.class, 200),
        Map.entry(ListTasksResult.Status200.class, 200),
        Map.entry(SearchTasksResult.Status200.class, 200));
    }

    @Override
    public Map<Class<?>, String> errorArms() {
        return Map.ofEntries(
        Map.entry(DeleteDraftErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(DeleteDraftErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(DeleteDraftErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(DeleteDraftErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(DeleteDraftErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(DeleteDraftErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(DeleteDraftErrors.ApiInternal.class, "api.internal"),
        Map.entry(GetChannelErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetChannelErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetChannelErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetChannelErrors.ApiInternal.class, "api.internal"),
        Map.entry(GetDraftErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetDraftErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetDraftErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetDraftErrors.ApiInternal.class, "api.internal"),
        Map.entry(GetTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(GetTasksBatchErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetTasksBatchErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetTasksBatchErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetTasksBatchErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(GetTasksBatchErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(GetTasksBatchErrors.ApiInternal.class, "api.internal"),
        Map.entry(HealthErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(HealthErrors.ApiInternal.class, "api.internal"),
        Map.entry(ListChannelsErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(ListChannelsErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(ListChannelsErrors.ApiInternal.class, "api.internal"),
        Map.entry(ListTasksErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(ListTasksErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(ListTasksErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(ListTasksErrors.ApiInternal.class, "api.internal"),
        Map.entry(SearchTasksErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(SearchTasksErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(SearchTasksErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(SearchTasksErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(SearchTasksErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(SearchTasksErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(SearchTasksErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(SearchTasksErrors.ApiInternal.class, "api.internal"));
    }

    @Override
    public Map<String, Class<?>> authenticateHooks() {
        return Map.ofEntries(
        Map.entry("user", UserAuthenticateHook.class));
    }

    @Override
    public Optional<String> contractCode(Throwable exception) {
        return exception instanceof TasksContractException contract ? Optional.of(contract.code()) : Optional.empty();
    }

    @Override
    public AuthenticateResult<?, Denial> authenticate(String identity, ListableBeanFactory beans,
            JsonMapper mapper, JsonNode credentials, Optional<String> csrfToken,
            RequestView request, OperationRef operation) {
        return switch (identity) {
            case "user" -> beans.getBean(UserAuthenticateHook.class).authenticate(new UserAuthenticateRequest(mapper.treeToValue(credentials, UserCredentials.class), csrfToken, request, operation, Map.of()));
            default -> throw new IllegalArgumentException("seampact: the identity '" + identity + "' is not one the operations of the api 'tasks' authenticate with");
        };
    }
}
