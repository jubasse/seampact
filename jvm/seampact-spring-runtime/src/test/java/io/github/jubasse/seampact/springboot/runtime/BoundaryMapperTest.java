package io.github.jubasse.seampact.springboot.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import io.github.jubasse.seampact.hooks.Field;
import java.util.List;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/** The boundary mapper's reading and writing of an optional nullable member: absent, null and a value stay apart. */
class BoundaryMapperTest {
    record Draft(Field<String> publishOn) {}

    record Tagged(Field<List<Integer>> ranks) {}

    private static final JsonMapper MAPPER = BoundaryMapper.create();

    @Test
    void readsAbsentNullAndAValueAsThreeStates() {
        assertEquals(Field.absent(), MAPPER.readValue("{}", Draft.class).publishOn());
        assertEquals(Field.ofNull(), MAPPER.readValue("{\"publishOn\":null}", Draft.class).publishOn());
        assertEquals(Field.of("2026-11-06"), MAPPER.readValue("{\"publishOn\":\"2026-11-06\"}", Draft.class).publishOn());
    }

    @Test
    void readsTheValueWithItsDeclaredType() {
        assertEquals(Field.of(List.of(1, 2)), MAPPER.readValue("{\"ranks\":[1,2]}", Tagged.class).ranks());
    }

    @Test
    void writesAbsentAsNoMemberNullAsNullAndAValueAsItself() {
        assertEquals("{}", MAPPER.writeValueAsString(new Draft(Field.absent())));
        assertEquals("{\"publishOn\":null}", MAPPER.writeValueAsString(new Draft(Field.ofNull())));
        assertEquals("{\"publishOn\":\"2026-11-06\"}", MAPPER.writeValueAsString(new Draft(Field.of("2026-11-06"))));
    }
}
