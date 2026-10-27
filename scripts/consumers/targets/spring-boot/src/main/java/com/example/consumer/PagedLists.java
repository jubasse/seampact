package com.example.consumer;

import com.example.tasks.api.ListChannelsInput;
import com.example.tasks.api.ListChannelsPage;
import com.example.tasks.api.ListChannelsResult;
import com.example.tasks.api.ListTasksInput;
import com.example.tasks.api.ListTasksPage;
import com.example.tasks.api.ListTasksResult;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.function.Supplier;

/** The paged lists of the reference contract, paged by cursor; the pack-spring and pack-laravel variants replace this file. */
final class PagedLists {
    private static final String API = "tasks";
    private static final String NEXT_CURSOR = "page-2";

    private PagedLists() {}

    static ListChannelsResult listChannels(ListChannelsInput input) {
        return new ListChannelsResult.Status200(new ListChannelsPage(List.of(SampleData.generalChannel()), Optional.empty()));
    }

    static ListTasksResult listTasks(ScriptedAnswers answers, ListTasksInput input) {
        // The first page links a second one; the second is the last.
        Optional<String> nextCursor = input.query().cursor().isPresent() ? Optional.empty() : Optional.of(NEXT_CURSOR);

        return answers.answer(API, "listTasks", 200, ListTasksPage.class, ListTasksResult.Status200::new, Map.<String, Supplier<ListTasksResult>>of())
                .orElseGet(() -> new ListTasksResult.Status200(new ListTasksPage(List.of(SampleData.task(SampleData.NEW_TASK_ID)), nextCursor)));
    }
}
