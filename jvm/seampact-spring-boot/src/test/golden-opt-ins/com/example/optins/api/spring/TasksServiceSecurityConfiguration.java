package com.example.optins.api.spring;

import com.example.optins.api.spring.runtime.SeampactBoundary;
import com.example.optins.api.spring.runtime.SecurityRefusals;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.env.Environment;
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
    public TasksServiceSecurityMatchers tasksServiceSecurityMatchers(Environment environment) {
        return new TasksServiceSecurityMatchers(environment.getProperty("spring.mvc.servlet.path", ""));
    }

    @Bean
    public SecurityRefusals tasksServiceSecurityRefusals(SeampactBoundary boundary) {
        return new SecurityRefusals(boundary);
    }

    /**
     * Permits the public and optional-auth routes in every chain, before the app's own rules.
     */
    @Bean
    public Customizer<HttpSecurity> tasksServiceSecurityCustomizer(
            TasksServiceSecurityMatchers matchers) {
        return http -> http.authorizeHttpRequests(authorize -> authorize.requestMatchers(matchers.publicRoutes(), matchers.optionalRoutes()).permitAll());
    }
}
