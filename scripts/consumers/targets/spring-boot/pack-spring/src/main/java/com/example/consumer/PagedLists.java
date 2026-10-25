package com.example.consumer;

import com.example.tasks.api.ListChannelsInput;
import com.example.tasks.api.ListChannelsResult;
import com.example.tasks.api.ListTasksInput;
import com.example.tasks.api.ListTasksResult;
import com.example.tasks.api.schemas.Task;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;

/**
 * The paged lists of the pack-spring contract, paged by Spring Data: the handler reads the boundary's `Pageable` and
 * answers a `Page` (ADR 0022 "Paging"). It replaces the reference variant's file.
 */
final class PagedLists {
    private static final String API = "tasks";
    private static final long SAMPLE_TOTAL = 3;

    private PagedLists() {}

    /** A scripted page in the handler's own shape: its items and, when the script gives it, the total. */
    record ScriptedPage(List<Task> items, Optional<Long> total) {}

    static ListChannelsResult listChannels(ListChannelsInput input) {
        return new ListChannelsResult.Status200(new PageImpl<>(List.of(SampleData.generalChannel()), input.pageable(), 1));
    }

    static ListTasksResult listTasks(ScriptedAnswers answers, ListTasksInput input) {
        return answers.answer(API, "listTasks", 200, ScriptedPage.class, scripted -> new ListTasksResult.Status200(pageOf(scripted, input)), Map.<String, Supplier<ListTasksResult>>of())
                .orElseGet(() -> new ListTasksResult.Status200(new PageImpl<>(List.of(SampleData.task(SampleData.NEW_TASK_ID)), input.pageable(), SAMPLE_TOTAL)));
    }

    private static Page<Task> pageOf(ScriptedPage scripted, ListTasksInput input) {
        return new PageImpl<>(scripted.items(), input.pageable(), scripted.total().orElse((long) scripted.items().size()));
    }
}
