package com.example.optins.api.spring;

import com.example.optins.api.BrowseTaskErrors;
import com.example.optins.api.BrowseTaskInput;
import com.example.optins.api.BrowseTaskResult;
import com.example.optins.api.GetTaskErrors;
import com.example.optins.api.GetTaskInput;
import com.example.optins.api.GetTaskResult;
import com.example.optins.api.PeekTaskErrors;
import com.example.optins.api.PeekTaskInput;
import com.example.optins.api.PeekTaskResult;
import com.example.optins.api.ServiceAuthenticateHook;
import com.example.optins.api.ServiceAuthenticateRequest;
import com.example.optins.api.ServiceCredentials;
import com.example.optins.api.SignTaskErrors;
import com.example.optins.api.SignTaskInput;
import com.example.optins.api.SignTaskResult;
import com.example.optins.api.StripeAuthenticateHook;
import com.example.optins.api.StripeAuthenticateRequest;
import com.example.optins.api.StripeCredentials;
import com.example.optins.api.TasksServiceContractException;
import com.example.optins.api.TasksServiceDecider;
import com.example.optins.api.TasksServiceScopeResolver;
import com.example.optins.api.TasksServiceUnexpectedErrorListener;
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
        Map.entry("getTask", GetTaskInput.class),
        Map.entry("browseTask", BrowseTaskInput.class),
        Map.entry("peekTask", PeekTaskInput.class),
        Map.entry("signTask", SignTaskInput.class));
    }

    @Override
    public Map<String, Class<? extends Annotation>> annotations() {
        return Map.ofEntries(
        Map.entry("getTask", GetTask.class),
        Map.entry("browseTask", BrowseTask.class),
        Map.entry("peekTask", PeekTask.class),
        Map.entry("signTask", SignTask.class));
    }

    @Override
    public Map<Class<?>, Integer> successArms() {
        return Map.ofEntries(
        Map.entry(GetTaskResult.Status200.class, 200),
        Map.entry(BrowseTaskResult.Status200.class, 200),
        Map.entry(PeekTaskResult.Status200.class, 200),
        Map.entry(SignTaskResult.Status200.class, 200));
    }

    @Override
    public Map<Class<?>, String> errorArms() {
        return Map.ofEntries(
        Map.entry(GetTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(GetTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(GetTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(GetTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(GetTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(GetTaskErrors.ApiDeadlineExceeded.class, "api.deadline_exceeded"),
        Map.entry(BrowseTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(BrowseTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(BrowseTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(BrowseTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(BrowseTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(BrowseTaskErrors.ApiDeadlineExceeded.class, "api.deadline_exceeded"),
        Map.entry(PeekTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(PeekTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(PeekTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(PeekTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(PeekTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(PeekTaskErrors.ApiDeadlineExceeded.class, "api.deadline_exceeded"),
        Map.entry(SignTaskErrors.ApiSchemaInvalid.class, "api.schema_invalid"),
        Map.entry(SignTaskErrors.ApiUnauthenticated.class, "api.unauthenticated"),
        Map.entry(SignTaskErrors.ApiForbidden.class, "api.forbidden"),
        Map.entry(SignTaskErrors.ApiNotFound.class, "api.not_found"),
        Map.entry(SignTaskErrors.ApiInternal.class, "api.internal"),
        Map.entry(SignTaskErrors.ApiDeadlineExceeded.class, "api.deadline_exceeded"));
    }

    @Override
    public Map<String, Class<?>> authenticateHooks() {
        return Map.ofEntries(
        Map.entry("service", ServiceAuthenticateHook.class),
        Map.entry("stripe", StripeAuthenticateHook.class));
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
    public String apiId() {
        return "tasksService";
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
            case "stripe" -> beans.getBean(StripeAuthenticateHook.class).authenticate(new StripeAuthenticateRequest(mapper.treeToValue(credentials, StripeCredentials.class), csrfToken, signature, request, operation, Map.of()));
            default -> throw new IllegalArgumentException("seampact: the identity '" + identity + "' is not one the operations of the api 'tasksService' authenticate with");
        };
    }
}
