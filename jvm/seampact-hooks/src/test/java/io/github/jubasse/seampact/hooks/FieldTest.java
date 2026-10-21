package io.github.jubasse.seampact.hooks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.NoSuchElementException;
import org.junit.jupiter.api.Test;

class FieldTest {
    @Test
    void keepsAbsentNullAndPresentApart() {
        Field<String> absent = Field.absent();
        Field<String> none = Field.ofNull();
        Field<String> present = Field.of("2026-01-01");

        assertTrue(absent.isAbsent());
        assertTrue(none.isNull());
        assertTrue(present.isPresent());
        assertFalse(none.isAbsent());
        assertNotEquals(absent, none);
        assertNotEquals(none, present);
        assertEquals("2026-01-01", present.value());
    }

    @Test
    void refusesTheValueOfAnAbsentOrNullField() {
        assertThrows(NoSuchElementException.class, () -> Field.absent().value());
        assertThrows(NoSuchElementException.class, () -> Field.ofNull().value());
    }

    @Test
    void refusesANullValueAndPointsToOfNull() {
        NullPointerException refusal = assertThrows(NullPointerException.class, () -> Field.of(null));

        assertTrue(refusal.getMessage().contains("Field.ofNull()"));
    }

    @Test
    void comparesByStateAndValue() {
        assertEquals(Field.of("a"), Field.of("a"));
        assertEquals(Field.of("a").hashCode(), Field.of("a").hashCode());
        assertNotEquals(Field.of("a"), Field.of("b"));
    }
}
