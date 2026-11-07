package com.example.consumer;

import com.example.tasks.api.spring.TasksSecurityMatchers;
import io.github.jubasse.seampact.springboot.runtime.SecurityRefusals;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.context.annotation.Profile;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.provisioning.InMemoryUserDetailsManager;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.csrf.CookieCsrfTokenRepository;
import org.springframework.security.web.csrf.CsrfTokenRequestAttributeHandler;

/**
 * The app's Spring Security chains (ADR 0022 "Native security layers"). The suite's chain lets every request reach the
 * boundary, whose access steps the suite tests; the {@value #SECURITY_REFUSALS_PROFILE} profile, which
 * {@code SecurityRefusalsTest} starts, refuses before the boundary: Basic authentication and the {@value #MEMBER_ROLE}
 * role on the identity routes, CSRF on every write. Both answer Spring Security's refusals with the generated
 * {@link SecurityRefusals}.
 */
@Configuration(proxyBeanMethods = false)
class SuiteSecurity {
    static final String SECURITY_REFUSALS_PROFILE = "security-refusals";
    static final String MEMBER_ROLE = "MEMBER";
    static final String MEMBER = "member";
    static final String VISITOR = "visitor";
    static final String PASSWORD = "suite-password";

    @Bean
    @Profile("!" + SECURITY_REFUSALS_PROFILE)
    SecurityFilterChain suiteChain(HttpSecurity http, SecurityRefusals refusals) {
        return http
                .csrf(csrf -> csrf.disable())
                .headers(headers -> headers.disable())
                .requestCache(cache -> cache.disable())
                .authorizeHttpRequests(authorize -> authorize.anyRequest().permitAll())
                .exceptionHandling(handling -> handling.authenticationEntryPoint(refusals).accessDeniedHandler(refusals))
                .build();
    }

    @Bean
    @Profile(SECURITY_REFUSALS_PROFILE)
    SecurityFilterChain refusingChain(HttpSecurity http, TasksSecurityMatchers matchers, SecurityRefusals refusals) {
        return http
                .csrf(csrf -> csrf
                        .csrfTokenRepository(CookieCsrfTokenRepository.withHttpOnlyFalse())
                        .csrfTokenRequestHandler(new CsrfTokenRequestAttributeHandler()))
                .headers(headers -> headers.disable())
                .requestCache(cache -> cache.disable())
                .httpBasic(basic -> basic.authenticationEntryPoint(refusals))
                .authorizeHttpRequests(authorize -> authorize
                        .requestMatchers(matchers.identityRoutes()).hasRole(MEMBER_ROLE)
                        .anyRequest().authenticated())
                .exceptionHandling(handling -> handling.authenticationEntryPoint(refusals).accessDeniedHandler(refusals))
                .build();
    }

    // Declared under every profile, so Boot logs no generated password into the suite's log lines.
    @Bean
    UserDetailsService suiteUsers() {
        return new InMemoryUserDetailsManager(
                User.withUsername(MEMBER).password("{noop}" + PASSWORD).roles(MEMBER_ROLE).build(),
                User.withUsername(VISITOR).password("{noop}" + PASSWORD).roles().build());
    }
}
