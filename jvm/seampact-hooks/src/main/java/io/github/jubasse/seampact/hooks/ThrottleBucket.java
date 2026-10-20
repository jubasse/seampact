package io.github.jubasse.seampact.hooks;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import java.util.Optional;

/**
 * The bucket a throttle rule counts in; the decider keeps the counter.
 *
 * @param id the bucket id
 * @param key a fixed-size digest of the key values, never the raw values, so a counter store stays bounded
 * @param values the values of the bucket's key sources, in declared order
 * @param limit empty when the contract leaves the limit for the server to bind
 * @param windowMs empty when the contract leaves the window for the server to bind
 */
public record ThrottleBucket(
        String id, String key, List<?> values, Optional<Long> limit, Optional<Long> windowMs) {
    public ThrottleBucket {
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(key, "key");
        // A key source may hold null, which List.copyOf refuses.
        values = Collections.unmodifiableList(new ArrayList<>(Objects.requireNonNull(values, "values")));
        Objects.requireNonNull(limit, "limit");
        Objects.requireNonNull(windowMs, "windowMs");
    }
}
