package com.example.tasksservice.api.spring;

import com.example.tasksservice.api.GetTaskErrors;
import com.example.tasksservice.api.GetTaskInput;
import com.example.tasksservice.api.GetTaskResult;
import com.example.tasksservice.api.ServiceAuthenticateHook;
import com.example.tasksservice.api.ServiceAuthenticateRequest;
import com.example.tasksservice.api.ServiceCredentials;
import com.example.tasksservice.api.TasksServiceContractException;
import com.example.tasksservice.api.TasksServiceDecider;
import com.example.tasksservice.api.TasksServiceScopeResolver;
import com.example.tasksservice.api.TasksServiceUnexpectedErrorListener;
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
 * The Java types of the api 'tasksService' its boundary runtime reads.
 */
public final class TasksServiceSeampactBinding implements ApiBinding {
    @Override
    public Map<String, Class<?>> inputTypes() {
        return Map.ofEntries(
        Map.entry("getTask", GetTaskInput.class));
    }

    @Override
    public Map<String, Class<? extends Annotation>> annotations() {
        return Map.ofEntries(
        Map.entry("getTask", GetTask.class));
    }

    @Override
    public Map<Class<?>, Integer> successArms() {
        return Map.ofEntries(
        Map.entry(GetTaskResult.Status200.class, 200));
    }

    @Override
    public Map<Class<?>, String> errorArms() {
        return Map.ofEntries(
        Map.entry(GetTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(GetTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(GetTaskErrors.ApiDeadlineExceeded.class, "api.deadline_exceeded"));
    }

    @Override
    public Map<String, Class<?>> authenticateHooks() {
        return Map.ofEntries(
        Map.entry("service", ServiceAuthenticateHook.class));
    }

    @Override
    public Class<? extends Decider> deciderType() {
        return TasksServiceDecider.class;
    }

    @Override
    public Class<? extends ScopeResolver> scopeResolverType() {
        return TasksServiceScopeResolver.class;
    }

    @Override
    public Class<? extends UnexpectedErrorListener> unexpectedErrorListenerType() {
        return TasksServiceUnexpectedErrorListener.class;
    }

    @Override
    public String generatorVersion() {
        return "0.0.0";
    }

    @Override
    public Optional<String> contractCode(Throwable exception) {
        return exception instanceof TasksServiceContractException contract ? Optional.of(contract.code()) : Optional.empty();
    }

    @Override
    public AuthenticateResult<?, Denial> authenticate(String identity, ListableBeanFactory beans,
            JsonMapper mapper, JsonNode credentials, Optional<String> csrfToken,
            Optional<SignedTemplateRequest> signature, RequestView request,
            OperationRef operation) {
        return switch (identity) {
            case "service" -> beans.getBean(ServiceAuthenticateHook.class).authenticate(new ServiceAuthenticateRequest(mapper.treeToValue(credentials, ServiceCredentials.class), csrfToken, request, operation, Map.of()));
            default -> throw new IllegalArgumentException("seampact: the identity '" + identity + "' is not one the operations of the api 'tasksService' authenticate with");
        };
    }
}
