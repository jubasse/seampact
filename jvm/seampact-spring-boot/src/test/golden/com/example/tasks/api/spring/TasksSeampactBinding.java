package com.example.tasks.api.spring;

import com.example.tasks.api.ArchiveTaskErrors;
import com.example.tasks.api.ArchiveTaskInput;
import com.example.tasks.api.ArchiveTaskResult;
import com.example.tasks.api.AssignTaskErrors;
import com.example.tasks.api.AssignTaskInput;
import com.example.tasks.api.AssignTaskResult;
import com.example.tasks.api.CreateTaskErrors;
import com.example.tasks.api.CreateTaskInput;
import com.example.tasks.api.CreateTaskResult;
import com.example.tasks.api.DeleteDraftErrors;
import com.example.tasks.api.DeleteDraftInput;
import com.example.tasks.api.DeleteDraftResult;
import com.example.tasks.api.GetChannelErrors;
import com.example.tasks.api.GetChannelInput;
import com.example.tasks.api.GetChannelResult;
import com.example.tasks.api.GetDraftErrors;
import com.example.tasks.api.GetDraftInput;
import com.example.tasks.api.GetDraftResult;
import com.example.tasks.api.GetPreferencesErrors;
import com.example.tasks.api.GetPreferencesInput;
import com.example.tasks.api.GetPreferencesResult;
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
import com.example.tasks.api.PaymentsErrors;
import com.example.tasks.api.PaymentsInput;
import com.example.tasks.api.PaymentsResult;
import com.example.tasks.api.PurgeTaskErrors;
import com.example.tasks.api.PurgeTaskInput;
import com.example.tasks.api.PurgeTaskResult;
import com.example.tasks.api.SearchTasksErrors;
import com.example.tasks.api.SearchTasksInput;
import com.example.tasks.api.SearchTasksResult;
import com.example.tasks.api.StripeAuthenticateHook;
import com.example.tasks.api.StripeAuthenticateRequest;
import com.example.tasks.api.StripeCredentials;
import com.example.tasks.api.TasksContractException;
import com.example.tasks.api.TasksDecider;
import com.example.tasks.api.TasksScopeResolver;
import com.example.tasks.api.TasksUnexpectedErrorListener;
import com.example.tasks.api.UpdatePreferencesErrors;
import com.example.tasks.api.UpdatePreferencesInput;
import com.example.tasks.api.UpdatePreferencesResult;
import com.example.tasks.api.UpdateTaskErrors;
import com.example.tasks.api.UpdateTaskInput;
import com.example.tasks.api.UpdateTaskResult;
import com.example.tasks.api.UserAuthenticateHook;
import com.example.tasks.api.UserAuthenticateRequest;
import com.example.tasks.api.UserCredentials;
import io.github.jubasse.seampact.hooks.AuthenticateResult;
import io.github.jubasse.seampact.hooks.OperationRef;
import io.github.jubasse.seampact.hooks.RequestView;
import io.github.jubasse.seampact.hooks.SignedTemplateRequest;
import io.github.jubasse.seampact.springboot.runtime.ApiBinding;
import io.github.jubasse.seampact.springboot.runtime.Decider;
import io.github.jubasse.seampact.springboot.runtime.Denial;
import io.github.jubasse.seampact.springboot.runtime.ScopeResolver;
import io.github.jubasse.seampact.springboot.runtime.UnexpectedErrorListener;
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
        Map.entry("archiveTask", ArchiveTaskInput.class),
        Map.entry("assignTask", AssignTaskInput.class),
        Map.entry("createTask", CreateTaskInput.class),
        Map.entry("deleteDraft", DeleteDraftInput.class),
        Map.entry("getChannel", GetChannelInput.class),
        Map.entry("getDraft", GetDraftInput.class),
        Map.entry("getPreferences", GetPreferencesInput.class),
        Map.entry("getTask", GetTaskInput.class),
        Map.entry("getTasksBatch", GetTasksBatchInput.class),
        Map.entry("health", HealthInput.class),
        Map.entry("listChannels", ListChannelsInput.class),
        Map.entry("listTasks", ListTasksInput.class),
        Map.entry("payments", PaymentsInput.class),
        Map.entry("purgeTask", PurgeTaskInput.class),
        Map.entry("searchTasks", SearchTasksInput.class),
        Map.entry("updatePreferences", UpdatePreferencesInput.class),
        Map.entry("updateTask", UpdateTaskInput.class));
    }

    @Override
    public Map<String, Class<? extends Annotation>> annotations() {
        return Map.ofEntries(
        Map.entry("archiveTask", ArchiveTask.class),
        Map.entry("assignTask", AssignTask.class),
        Map.entry("createTask", CreateTask.class),
        Map.entry("deleteDraft", DeleteDraft.class),
        Map.entry("getChannel", GetChannel.class),
        Map.entry("getDraft", GetDraft.class),
        Map.entry("getPreferences", GetPreferences.class),
        Map.entry("getTask", GetTask.class),
        Map.entry("getTasksBatch", GetTasksBatch.class),
        Map.entry("health", Health.class),
        Map.entry("listChannels", ListChannels.class),
        Map.entry("listTasks", ListTasks.class),
        Map.entry("payments", Payments.class),
        Map.entry("purgeTask", PurgeTask.class),
        Map.entry("searchTasks", SearchTasks.class),
        Map.entry("updatePreferences", UpdatePreferences.class),
        Map.entry("updateTask", UpdateTask.class));
    }

    @Override
    public Map<Class<?>, Integer> successArms() {
        return Map.ofEntries(
        Map.entry(ArchiveTaskResult.Status200.class, 200),
        Map.entry(AssignTaskResult.Status200.class, 200),
        Map.entry(CreateTaskResult.Status201.class, 201),
        Map.entry(DeleteDraftResult.Status200.class, 200),
        Map.entry(GetChannelResult.Status200.class, 200),
        Map.entry(GetDraftResult.Status200.class, 200),
        Map.entry(GetPreferencesResult.Status200.class, 200),
        Map.entry(GetTaskResult.Status200.class, 200),
        Map.entry(GetTasksBatchResult.Status200.class, 200),
        Map.entry(HealthResult.Status200.class, 200),
        Map.entry(ListChannelsResult.Status200.class, 200),
        Map.entry(ListTasksResult.Status200.class, 200),
        Map.entry(PaymentsResult.Status204.class, 204),
        Map.entry(PurgeTaskResult.Status204.class, 204),
        Map.entry(SearchTasksResult.Status200.class, 200),
        Map.entry(UpdatePreferencesResult.Status200.class, 200),
        Map.entry(UpdateTaskResult.Status200.class, 200));
    }

    @Override
    public Map<Class<?>, String> errorArms() {
        return Map.ofEntries(
        Map.entry(ArchiveTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(ArchiveTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(ArchiveTaskErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(ArchiveTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(ArchiveTaskErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(ArchiveTaskErrors.StateConflict.class, "state.conflict"),
        Map.entry(ArchiveTaskErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(ArchiveTaskErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(ArchiveTaskErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(ArchiveTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(AssignTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(AssignTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(AssignTaskErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(AssignTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(AssignTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(AssignTaskErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(AssignTaskErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(AssignTaskErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(AssignTaskErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(AssignTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(CreateTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(CreateTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(CreateTaskErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(CreateTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(CreateTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(CreateTaskErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(CreateTaskErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(CreateTaskErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(CreateTaskErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(CreateTaskErrors.ApiRateLimited.class, "api.rate_limited"),
        Map.entry(CreateTaskErrors.ApiInternal.class, "api.internal"),
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
        Map.entry(GetPreferencesErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetPreferencesErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetPreferencesErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetPreferencesErrors.ApiInternal.class, "api.internal"),
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
        Map.entry(PaymentsErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(PaymentsErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(PaymentsErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(PaymentsErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(PaymentsErrors.ApiInternal.class, "api.internal"),
        Map.entry(PurgeTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(PurgeTaskErrors.ApiReauthenticationRequired.class, "api.reauthentication_required"),
        Map.entry(PurgeTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(PurgeTaskErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(PurgeTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(PurgeTaskErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(PurgeTaskErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(PurgeTaskErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(PurgeTaskErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(PurgeTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(SearchTasksErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(SearchTasksErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(SearchTasksErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(SearchTasksErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(SearchTasksErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(SearchTasksErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(SearchTasksErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(SearchTasksErrors.ApiInternal.class, "api.internal"),
        Map.entry(UpdatePreferencesErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(UpdatePreferencesErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(UpdatePreferencesErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(UpdatePreferencesErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(UpdatePreferencesErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(UpdatePreferencesErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(UpdatePreferencesErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(UpdatePreferencesErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(UpdatePreferencesErrors.ApiInternal.class, "api.internal"),
        Map.entry(UpdateTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(UpdateTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(UpdateTaskErrors.ApiCsrfInvalid.class, "api.csrf_invalid"),
        Map.entry(UpdateTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(UpdateTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(UpdateTaskErrors.ApiIdempotencyInProgress.class, "api.idempotency_in_progress"),
        Map.entry(UpdateTaskErrors.StateConflict.class, "state.conflict"),
        Map.entry(UpdateTaskErrors.ApiPayloadTooLarge.class, "api.payload_too_large"),
        Map.entry(UpdateTaskErrors.ApiUnsupportedMediaType.class, "api.unsupported_media_type"),
        Map.entry(UpdateTaskErrors.ApiIdempotencyKeyReused.class, "api.idempotency_key_reused"),
        Map.entry(UpdateTaskErrors.ApiInternal.class, "api.internal"));
    }

    @Override
    public Map<String, Class<?>> authenticateHooks() {
        return Map.ofEntries(
        Map.entry("user", UserAuthenticateHook.class),
        Map.entry("stripe", StripeAuthenticateHook.class));
    }

    @Override
    public Class<? extends Decider> deciderType() {
        return TasksDecider.class;
    }

    @Override
    public Class<? extends ScopeResolver> scopeResolverType() {
        return TasksScopeResolver.class;
    }

    @Override
    public Class<? extends UnexpectedErrorListener> unexpectedErrorListenerType() {
        return TasksUnexpectedErrorListener.class;
    }

    @Override
    public String generatorVersion() {
        return "0.0.0";
    }

    @Override
    public Optional<String> contractCode(Throwable exception) {
        return exception instanceof TasksContractException contract ? Optional.of(contract.code()) : Optional.empty();
    }

    @Override
    public AuthenticateResult<?, Denial> authenticate(String identity, ListableBeanFactory beans,
            JsonMapper mapper, JsonNode credentials, Optional<String> csrfToken,
            Optional<SignedTemplateRequest> signature, RequestView request,
            OperationRef operation) {
        return switch (identity) {
            case "user" -> beans.getBean(UserAuthenticateHook.class).authenticate(new UserAuthenticateRequest(mapper.treeToValue(credentials, UserCredentials.class), csrfToken, request, operation, Map.of()));
            case "stripe" -> beans.getBean(StripeAuthenticateHook.class).authenticate(new StripeAuthenticateRequest(mapper.treeToValue(credentials, StripeCredentials.class), csrfToken, signature, request, operation, Map.of()));
            default -> throw new IllegalArgumentException("seampact: the identity '" + identity + "' is not one the operations of the api 'tasks' authenticate with");
        };
    }
}
