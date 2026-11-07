package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** The public origin absolute URLs start with, and its boot check (ADR 0022 "Absolute URLs"). */
class PublicOriginTest {
    private static final String PROPERTY = "seampact.tasks.public-origin";

    private static ContractTable tableWithUrls(String urls) {
        return new ContractTable(BoundaryMapper.create().readTree(
                "{\"api\": {\"id\": \"tasks\", \"wire\": {\"urls\": \"" + urls + "\"}}, \"operations\": []}"));
    }

    private static MockEnvironment environmentWith(String origin) {
        return new MockEnvironment().withProperty(PROPERTY, origin);
    }

    @Test
    void relativeUrlsNeedNoOrigin() {
        ContractTable table = tableWithUrls("relative");

        assertEquals(Optional.empty(), PublicOrigin.bootProblem(table, new MockEnvironment()));
        assertEquals(Optional.empty(), PublicOrigin.of(table, environmentWith("https://api.example.com")));
    }

    @Test
    void absoluteUrlsWithoutTheOriginAreABootProblemNamingTheProperty() {
        Optional<String> problem = PublicOrigin.bootProblem(tableWithUrls("absolute"), new MockEnvironment());

        assertTrue(problem.orElseThrow().contains(PROPERTY), problem::orElseThrow);
    }

    @Test
    void anOriginWithAPathOrNoSchemeIsABootProblem() {
        ContractTable table = tableWithUrls("absolute");

        assertTrue(PublicOrigin.bootProblem(table, environmentWith("https://api.example.com/")).isPresent());
        assertTrue(PublicOrigin.bootProblem(table, environmentWith("https://api.example.com/v1")).isPresent());
        assertTrue(PublicOrigin.bootProblem(table, environmentWith("api.example.com")).isPresent());
        assertTrue(PublicOrigin.bootProblem(table, environmentWith("ftp://api.example.com")).isPresent());
    }

    @Test
    void aSchemeHostAndPortIsTheOrigin() {
        ContractTable table = tableWithUrls("absolute");
        MockEnvironment environment = environmentWith("https://api.example.com:8443");

        assertEquals(Optional.empty(), PublicOrigin.bootProblem(table, environment));
        assertEquals(Optional.of("https://api.example.com:8443"), PublicOrigin.of(table, environment));
    }
}
