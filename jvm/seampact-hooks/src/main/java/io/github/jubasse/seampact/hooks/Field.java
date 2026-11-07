package io.github.jubasse.seampact.hooks;

import java.util.Locale;
import java.util.NoSuchElementException;
import java.util.Objects;

/**
 * A property that is both optional and nullable (ADR 0003 section 5): absent, null, or a value, three distinct
 * states, so {@code {}} and {@code {"publishOn": null}} reach the handler apart.
 *
 * @param <T> the property's value
 */
public final class Field<T> {
    private enum State {
        ABSENT,
        NULL,
        PRESENT
    }

    private final State state;
    private final T value;

    private Field(State state, T value) {
        this.state = state;
        this.value = value;
    }

    /** The property is not in the payload. */
    public static <T> Field<T> absent() {
        return new Field<>(State.ABSENT, null);
    }

    /** The property is in the payload as {@code null}. */
    public static <T> Field<T> ofNull() {
        return new Field<>(State.NULL, null);
    }

    /** The property holds a value; a null value is refused, since {@link #ofNull()} says it. */
    public static <T> Field<T> of(T value) {
        return new Field<>(State.PRESENT, Objects.requireNonNull(value, "value, use Field.ofNull() for null"));
    }

    public boolean isAbsent() {
        return state == State.ABSENT;
    }

    public boolean isNull() {
        return state == State.NULL;
    }

    public boolean isPresent() {
        return state == State.PRESENT;
    }

    /** The value, when present. */
    public T value() {
        if (state != State.PRESENT) {
            throw new NoSuchElementException("The field is " + state.name().toLowerCase(Locale.ROOT) + "; check isPresent() first.");
        }

        return value;
    }

    @Override
    public boolean equals(Object other) {
        return other instanceof Field<?> that && state == that.state && Objects.equals(value, that.value);
    }

    @Override
    public int hashCode() {
        return Objects.hash(state, value);
    }

    @Override
    public String toString() {
        return state == State.PRESENT ? "Field[" + value + "]" : "Field[" + state.name().toLowerCase(Locale.ROOT) + "]";
    }
}
