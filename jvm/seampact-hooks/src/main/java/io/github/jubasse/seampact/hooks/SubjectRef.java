package io.github.jubasse.seampact.hooks;

import java.util.Objects;
import java.util.Optional;

/**
 * What a right is about: a resource type or a scope name, the id from its declared source, and the loaded record
 * when a loader is registered.
 *
 * @param type the resource type or scope name
 * @param id the id from the subject's declared source
 * @param record the loaded record, when the application registers a loader for the resource type
 * @param <Id> the subject's id
 * @param <LoadedRecord> the record the loader returns
 */
public record SubjectRef<Id, LoadedRecord>(String type, Id id, Optional<LoadedRecord> record) {
    public SubjectRef {
        Objects.requireNonNull(type, "type");
        Objects.requireNonNull(id, "id");
        Objects.requireNonNull(record, "record");
    }
}
