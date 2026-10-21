package io.github.jubasse.seampact.hooks;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertInstanceOf;

import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;

/** A decider over a requirement with two declared codes: a denial can only name one of them. */
class TypedDeciderTest {
    sealed interface OrderCodes extends ErrorCodeWithParams permits OrderLocked, OrderMissing {}

    record OrderLocked(String lockedBy) implements OrderCodes {
        @Override
        public String code() {
            return "order_locked";
        }

        @Override
        public Optional<String> params() {
            return Optional.of(lockedBy);
        }
    }

    record OrderMissing() implements OrderCodes {
        @Override
        public String code() {
            return "order_missing";
        }
    }

    record OrderRequest(Optional<String> params, String principal)
            implements RequirementRequest<OrderCodes, String, String, String, String> {
        @Override
        public RequirementKind kind() {
            return RequirementKind.RULE;
        }

        @Override
        public String name() {
            return "orderIsOpen";
        }

        @Override
        public Optional<SubjectRef<?, ?>> subject() {
            return Optional.empty();
        }

        @Override
        public List<ResolvedScope<?, ?>> scopes() {
            return List.of();
        }

        @Override
        public Optional<?> proof() {
            return Optional.empty();
        }

        @Override
        public Optional<ThrottleBucket> bucket() {
            return Optional.empty();
        }

        @Override
        public Purpose purpose() {
            return new Purpose.Route();
        }

        @Override
        public OperationRef operation() {
            return new OperationRef("shop", "getOrder");
        }

        @Override
        public RequestView request() {
            return new RequestView("GET", "/orders/1", Map.of(), Optional.empty());
        }

        @Override
        public Extensions<String, String> extensions() {
            return new Extensions<>("requirement", "operation");
        }
    }

    private static final DecideHook<OrderRequest, OrderCodes> DECIDER = request -> switch (request.params().orElse("")) {
        case "locked" -> new Decision.Denied<>(new OrderLocked(request.principal()));
        case "missing" -> new Decision.Denied<>(new OrderMissing());
        default -> new Decision.Allowed<>();
    };

    @Test
    void allowsAnOpenOrder() {
        assertInstanceOf(Decision.Allowed.class, DECIDER.decide(new OrderRequest(Optional.empty(), "ana")));
    }

    @Test
    void deniesWithADeclaredCodeAndItsParams() {
        Decision<OrderCodes> decision = DECIDER.decide(new OrderRequest(Optional.of("locked"), "ana"));

        String described = switch (decision) {
            case Decision.Allowed<OrderCodes> allowed -> "allowed";
            case Decision.Denied<OrderCodes> denied -> switch (denied.deny()) {
                case OrderLocked locked -> locked.code() + ":" + locked.params().orElseThrow();
                case OrderMissing missing -> missing.code();
            };
        };

        assertEquals("order_locked:ana", described);
    }
}
