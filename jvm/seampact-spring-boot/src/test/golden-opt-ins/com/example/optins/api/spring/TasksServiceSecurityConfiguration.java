package com.example.optins.api.spring;

import com.example.optins.api.spring.runtime.SeampactBoundary;
import com.example.optins.api.spring.runtime.SecurityRefusals;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;

/**
 * The Spring Security beans of the api 'tasksService'; the app wires the refusals in its own chain.
 */
@Configuration(
        proxyBeanMethods = false
)
public class TasksServiceSecurityConfiguration {
    @Bean
    public TasksServiceSecurityMatchers tasksServiceSecurityMatchers(SeampactBoundary boundary) {
        return new TasksServiceSecurityMatchers(boundary);
    }

    @Bean
    public SecurityRefusals tasksServiceSecurityRefusals(SeampactBoundary boundary) {
        return new SecurityRefusals(boundary);
    }

    /**
     * Permits the public, optional-auth and signed routes in every chain, before the app's own rules and, being
     * ordered first, before the app's own customizers; the boundary checks the signature of a signed route.
     */
    @Bean
    @Order(Ordered.HIGHEST_PRECEDENCE)
    public Customizer<HttpSecurity> tasksServiceSecurityCustomizer(
            TasksServiceSecurityMatchers matchers) {
        return http -> http.authorizeHttpRequests(authorize -> authorize.requestMatchers(matchers.publicRoutes(), matchers.optionalRoutes(), matchers.signedRoutes()).permitAll());
    }
}
