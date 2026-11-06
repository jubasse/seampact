package com.example.consumer;

import java.util.Arrays;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.PathMatchConfigurer;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Under the `mount-mismatch` boot variant, Spring MVC serves the `tasks` api's controllers under the path prefix
 * `/mounted`, which the entry's mount (none) does not state.
 */
@Configuration(proxyBeanMethods = false)
@ServedUnder("mount-mismatch")
class MismatchedMountConfiguration implements WebMvcConfigurer {
    private static final String MISMATCHED_MOUNT = "/mounted";
    private static final String TASKS_API_PACKAGE = "com.example.tasks.api";

    @Override
    public void configurePathMatch(PathMatchConfigurer configurer) {
        configurer.addPathPrefix(MISMATCHED_MOUNT, MismatchedMountConfiguration::servesTasksApi);
    }

    private static boolean servesTasksApi(Class<?> controller) {
        return Arrays.stream(controller.getInterfaces()).anyMatch(api -> api.getPackageName().equals(TASKS_API_PACKAGE));
    }
}
