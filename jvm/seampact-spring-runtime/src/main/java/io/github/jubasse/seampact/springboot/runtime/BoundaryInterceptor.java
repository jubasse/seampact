package io.github.jubasse.seampact.springboot.runtime;

import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Optional;
import org.springframework.web.method.HandlerMethod;
import org.springframework.web.servlet.HandlerInterceptor;
import tools.jackson.databind.node.MissingNode;

/**
 * Steps 2 to 8 (ADR 0022 "Placement"), after Spring Security and before Spring binds any argument: it first checks
 * that the handler Spring chose carries the operation the raw path matched, then runs the access steps and step 6.
 * A refusal is written by the boundary and the handler never runs. The steps run on the `REQUEST` dispatch only; a
 * contract handler reached again by a forward, an include or an error dispatch is a violation. A hook that throws is
 * the api's 500, except Spring Security's `AccessDeniedException`, which the exception resolver answers.
 */
public final class BoundaryInterceptor implements HandlerInterceptor {
    private final SeampactBoundary boundary;

    public BoundaryInterceptor(SeampactBoundary boundary) {
        this.boundary = boundary;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) {
        Optional<BoundaryExchange> found = boundary.exchangeOf(request);
        Optional<String> handlerOperation = handler instanceof HandlerMethod method ? boundary.operationOf(method.getMethod()) : Optional.empty();

        if (found.isEmpty()) {
            if (handlerOperation.isEmpty()) return true;
            throw new IllegalStateException("seampact: the contract handler of '" + handlerOperation.get()
                    + "' was reached without the boundary filter (a forward, an include, or the filter not registered)");
        }

        BoundaryExchange exchange = found.get();
        DispatcherType dispatch = request.getDispatcherType();
        if (dispatch == DispatcherType.ASYNC) return true;
        if (dispatch != DispatcherType.REQUEST) {
            if (handlerOperation.isEmpty()) return true;
            exchange.violation = Optional.of("the contract handler of '" + handlerOperation.get() + "' was reached by a " + dispatch + " dispatch");
            return false;
        }

        if (handlerOperation.isEmpty()) {
            exchange.violation = Optional.of("a handler other than the operation's contract method took the route");
            return false;
        }

        try {
            if (!handlerOperation.get().equals(exchange.route().id())) {
                // Tomcat decoded the path to another contract route than the raw path matched (`%73earch`).
                String code = BoundaryFilter.roleCode(exchange.route(), ContractTable.NOT_FOUND_ROLE);
                throw new ContractRefusal(code, MissingNode.getInstance());
            }

            AccessSteps.run(boundary, exchange, request);
            InputStep.run(boundary, exchange, request);
            if (IdempotencyStep.begin(boundary, exchange)) return false;
        } catch (ContractRefusal refusal) {
            boundary.writeRefusal(exchange, refusal);
            return false;
        } catch (IOException failure) {
            boundary.writeUnexpected(exchange, "replaying a stored reply failed", failure);
            return false;
        } catch (RuntimeException failure) {
            if (AccessSteps.isAccessDenied(failure)) throw failure;
            boundary.writeUnexpected(exchange, "a hook or a step of the boundary failed", failure);
            return false;
        }

        exchange.admitted = true;

        return true;
    }
}
