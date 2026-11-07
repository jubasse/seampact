package io.github.jubasse.seampact.hooks;

import java.util.Objects;

/** Why the boundary asks: the route's requirement, a restricted field, or a restricted sort key. */
public sealed interface Purpose permits Purpose.Route, Purpose.Field, Purpose.SortKey {
    /** The route's requirement. */
    record Route() implements Purpose {}

    /**
     * A restricted field.
     *
     * @param pointer the field's JSON pointer
     * @param direction whether the field is read or written
     */
    record Field(String pointer, FieldDirection direction) implements Purpose {
        public Field {
            Objects.requireNonNull(pointer, "pointer");
            Objects.requireNonNull(direction, "direction");
        }
    }

    /**
     * A restricted sort key.
     *
     * @param key the sort key
     */
    record SortKey(String key) implements Purpose {
        public SortKey {
            Objects.requireNonNull(key, "key");
        }
    }
}
