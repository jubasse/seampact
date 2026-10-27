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

    /** The names of the beans implementing [runtimeType] but none of the interfaces an api generates from it. */
    static List<String> unkeyed(ListableBeanFactory beans, Class<?> runtimeType) {
        List<String> names = new ArrayList<>();
        beans.getBeansOfType(runtimeType).forEach((name, bean) -> {
            if (!implementsApiInterface(bean.getClass(), runtimeType)) names.add(name);
        });

        return names;
    }

    private static boolean implementsApiInterface(Class<?> type, Class<?> runtimeType) {
        for (Class<?> current = type; current != null; current = current.getSuperclass()) {
            for (Class<?> implemented : current.getInterfaces()) {
                if (extendsRuntimeType(implemented, runtimeType)) return true;
            }
        }

        return false;
    }

    // An interface below [runtimeType], at any depth, other than [runtimeType] itself.
    private static boolean extendsRuntimeType(Class<?> implemented, Class<?> runtimeType) {
        if (implemented.equals(runtimeType)) return false;
        if (runtimeType.isAssignableFrom(implemented)) return true;

        for (Class<?> parent : implemented.getInterfaces()) {
            if (extendsRuntimeType(parent, runtimeType)) return true;
        }

        return false;
    }
}
