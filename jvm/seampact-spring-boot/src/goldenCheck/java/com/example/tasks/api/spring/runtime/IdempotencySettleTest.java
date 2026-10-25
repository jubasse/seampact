package com.example.tasks.api.spring.runtime;

import static org.junit.jupiter.api.Assertions.assertEquals;

import com.example.tasks.api.spring.TasksContractTable;
import com.example.tasks.api.spring.TasksSeampactBinding;
import io.github.jubasse.seampact.hooks.IdempotencyBegin;
import io.github.jubasse.seampact.hooks.IdempotencyClaim;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import io.github.jubasse.seampact.hooks.StoredResponse;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.support.StaticListableBeanFactory;
import org.springframework.core.env.StandardEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;

/** How the boundary settles the claimed record of an idempotent request once its reply is known (ADR 0012). */
class IdempotencySettleTest {
    private static final String CREATE_TASK_PATH = "/v1/channels/c1/tasks";
    private static final String CLAIMED_KEY = "key-1";
    private static final int CREATED = 201;
    private static final int CONFLICT = 409;

    private final RecordingStore store = new RecordingStore();
    private final SeampactBoundary boundary = boundaryWith(store);

    private static SeampactBoundary boundaryWith(IdempotencyStore store) {
        StaticListableBeanFactory beans = new StaticListableBeanFactory();
        beans.addBean("idempotencyStore", store);

        return new SeampactBoundary(TasksContractTable.json(), new TasksSeampactBinding(), beans, new StandardEnvironment());
    }

    private void settleReply(int status, String cacheControl) {
        CheckingResponse response = new CheckingResponse(new MockHttpServletResponse(), true);
        response.setStatus(status);
        response.setHeader("Cache-Control", cacheControl);
        BoundaryExchange exchange = new BoundaryExchange(boundary.table().match("POST", CREATE_TASK_PATH).orElseThrow(), CREATE_TASK_PATH, response);
        exchange.idempotencyKey = CLAIMED_KEY;

        IdempotencyStep.settle(boundary, exchange, new byte[0]);
    }

    @Test
    void anErrorReplyMarkedNoStoreIsNotKeptForAReplay() {
        settleReply(CONFLICT, "private, No-Store");

        assertEquals(List.of(), store.completed);
        assertEquals(List.of(CLAIMED_KEY), store.abandoned);
    }

    @Test
    void aSuccessMarkedNoStoreIsKeptForAReplay() {
        settleReply(CREATED, "private, No-Store");

        assertEquals(List.of(CLAIMED_KEY), store.completed);
        assertEquals(List.of(), store.abandoned);
    }

    @Test
    void aReplyWithoutNoStoreIsKeptForAReplay() {
        settleReply(CREATED, "private");

        assertEquals(List.of(CLAIMED_KEY), store.completed);
    }

    private static final class RecordingStore implements IdempotencyStore {
        private final List<String> completed = new ArrayList<>();
        private final List<String> abandoned = new ArrayList<>();

        @Override
        public IdempotencyBegin begin(IdempotencyClaim claim) {
            throw new UnsupportedOperationException("settling never claims a key");
        }

        @Override
        public void complete(String key, StoredResponse response) {
            completed.add(key);
        }

        @Override
        public void abandon(String key) {
            abandoned.add(key);
        }
    }
}
