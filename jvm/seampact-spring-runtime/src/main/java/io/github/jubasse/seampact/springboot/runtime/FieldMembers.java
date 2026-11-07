package io.github.jubasse.seampact.springboot.runtime;

import com.fasterxml.jackson.annotation.JsonInclude;
import io.github.jubasse.seampact.hooks.Field;
import tools.jackson.core.JsonGenerator;
import tools.jackson.core.JsonParser;
import tools.jackson.databind.BeanProperty;
import tools.jackson.databind.DeserializationContext;
import tools.jackson.databind.JavaType;
import tools.jackson.databind.SerializationContext;
import tools.jackson.databind.ValueDeserializer;
import tools.jackson.databind.ValueSerializer;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.module.SimpleModule;

/**
 * How the boundary mapper reads and writes an optional nullable member, a {@link Field}: a missing member is
 * {@link Field#absent()}, an explicit {@code null} is {@link Field#ofNull()}, any other value is read with the
 * member's declared type; an absent field is written as no member at all.
 */
final class FieldMembers {
    // Per-type inclusion: a Field property is skipped when its serializer says it is empty, that is absent.
    private static final JsonInclude.Value ABSENT_LEFT_OUT =
            JsonInclude.Value.construct(JsonInclude.Include.NON_EMPTY, JsonInclude.Include.ALWAYS);

    private FieldMembers() {}

    static void register(JsonMapper.Builder builder) {
        SimpleModule fields = new SimpleModule("seampact-fields");
        fields.addDeserializer(Field.class, new FieldReader(null));
        fields.addSerializer(new FieldWriter());

        builder.addModule(fields).withConfigOverride(Field.class, override -> override.setInclude(ABSENT_LEFT_OUT));
    }

    private static final class FieldReader extends ValueDeserializer<Field<?>> {
        private final JavaType valueType;

        FieldReader(JavaType valueType) {
            this.valueType = valueType;
        }

        @Override
        public ValueDeserializer<?> createContextual(DeserializationContext context, BeanProperty property) {
            JavaType fieldType = context.getContextualType();
            if (fieldType == null || fieldType.containedTypeCount() != 1) {
                throw new IllegalStateException("seampact: a Field member must declare its value type, such as Field<String>; regenerate the api.");
            }

            return new FieldReader(fieldType.containedType(0));
        }

        @Override
        public Field<?> deserialize(JsonParser parser, DeserializationContext context) {
            if (valueType == null) {
                throw new IllegalStateException("seampact: a Field is read only as a member of a generated type.");
            }

            return Field.of(context.readValue(parser, valueType));
        }

        @Override
        public Field<?> getNullValue(DeserializationContext context) {
            return Field.ofNull();
        }

        @Override
        public Field<?> getAbsentValue(DeserializationContext context) {
            return Field.absent();
        }
    }

    private static final class FieldWriter extends ValueSerializer<Field<?>> {
        @Override
        public Class<?> handledType() {
            return Field.class;
        }

        @Override
        public void serialize(Field<?> field, JsonGenerator generator, SerializationContext context) {
            if (field.isPresent()) {
                context.writeValue(generator, field.value());
            } else {
                generator.writeNull();
            }
        }

        @Override
        public boolean isEmpty(SerializationContext context, Field<?> field) {
            return field == null || field.isAbsent();
        }
    }
}
