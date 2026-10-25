package com.example.tasks.api.spring;

import com.example.tasks.api.spring.runtime.SeampactBoundary;
import com.example.tasks.api.spring.runtime.SecurityRefusals;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;

/**
 * The Spring Security beans of the api 'tasks'; the app wires the refusals in its own chain.
 */
@Configuration(
        proxyBeanMethods = false
)
public class TasksSecurityConfiguration {
    @Bean
    public TasksSecurityMatchers tasksSecurityMatchers(Environment environment) {
        return new TasksSecurityMatchers(environment.getProperty("spring.mvc.servlet.path", ""));
    }

    @Bean
    public SecurityRefusals tasksSecurityRefusals(SeampactBoundary boundary) {
        return new SecurityRefusals(boundary);
    }

    /**
     * Permits the public and optional-auth routes in every chain, before the app's own rules.
     */
    @Bean
    public Customizer<HttpSecurity> tasksSecurityCustomizer(TasksSecurityMatchers matchers) {
        return http -> http.authorizeHttpRequests(authorize -> authorize.requestMatchers(matchers.publicRoutes(), matchers.optionalRoutes()).permitAll());
    }
}
