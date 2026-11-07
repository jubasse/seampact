package io.github.jubasse.seampact.springboot.runtime;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.ListableBeanFactory;

/**
 * The hook beans of one api (ADR 0025 "The runtime packages"): two apis share the runtime, so each looks its deciders,
 * scope resolvers and unexpected-error listeners up by the interface its generated code declares, never by the
 * runtime's own type, and one api never calls another api's hook.
 */
final class ApiHookBeans {
    private ApiHookBeans() {
    }

    /** The beans implementing [apiType], the api's generated interface of a runtime hook type, by bean name. */
    static <T> Map<String, T> of(ListableBeanFactory beans, Class<? extends T> apiType) {
        return new LinkedHashMap<>(beans.getBeansOfType(apiType));
    }

    /** The interface [binding]'s api generates from the runtime hook type [runtimeType]. */
    static Class<?> generatedType(ApiBinding binding, Class<?> runtimeType) {
        if (runtimeType.equals(Decider.class)) return binding.deciderType();
        if (runtimeType.equals(ScopeResolver.class)) return binding.scopeResolverType();
        if (runtimeType.equals(UnexpectedErrorListener.class)) return binding.unexpectedErrorListenerType();

        throw new IllegalArgumentException("seampact: " + runtimeType.getName() + " is not a runtime hook type");
    }

    /** The names of the beans implementing [runtimeType] but none of [generatedTypes], the interfaces the apis generate. */
    static List<String> unkeyed(ListableBeanFactory beans, Class<?> runtimeType, List<Class<?>> generatedTypes) {
        List<String> names = new ArrayList<>();
        beans.getBeansOfType(runtimeType).forEach((name, bean) -> {
            if (generatedTypes.stream().noneMatch(generatedType -> generatedType.isInstance(bean))) names.add(name);
        });

        return names;
    }
}
