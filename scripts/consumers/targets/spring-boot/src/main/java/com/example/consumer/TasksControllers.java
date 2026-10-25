package com.example.consumer;

import com.example.tasks.api.AppEndpoints;
import com.example.tasks.api.ChannelsEndpoints;
import com.example.tasks.api.DeleteDraftInput;
import com.example.tasks.api.DeleteDraftResult;
import com.example.tasks.api.DraftsEndpoints;
import com.example.tasks.api.GetChannelInput;
import com.example.tasks.api.GetChannelResult;
import com.example.tasks.api.GetDraftInput;
import com.example.tasks.api.GetDraftResult;
import com.example.tasks.api.GetTaskErrors;
import com.example.tasks.api.GetTaskInput;
import com.example.tasks.api.GetTaskResult;
import com.example.tasks.api.GetTasksBatchInput;
import com.example.tasks.api.GetTasksBatchResult;
import com.example.tasks.api.HealthInput;
import com.example.tasks.api.HealthResult;
import com.example.tasks.api.ListChannelsInput;
import com.example.tasks.api.ListChannelsPage;
import com.example.tasks.api.ListChannelsResult;
import com.example.tasks.api.ListTasksInput;
import com.example.tasks.api.ListTasksPage;
import com.example.tasks.api.ListTasksResult;
import com.example.tasks.api.SearchTasksInput;
import com.example.tasks.api.SearchTasksResult;
import com.example.tasks.api.TasksEndpoints;
import com.example.tasks.api.schemas.Channel;
import com.example.tasks.api.schemas.Draft;
import com.example.tasks.api.schemas.Health;
import com.example.tasks.api.schemas.Task;
import com.example.tasks.api.schemas.TaskSearchResult;
import com.example.tasks.api.spring.DeleteDraft;
import com.example.tasks.api.spring.GetChannel;
import com.example.tasks.api.spring.GetDraft;
import com.example.tasks.api.spring.GetTask;
import com.example.tasks.api.spring.GetTasksBatch;
import com.example.tasks.api.spring.ListChannels;
import com.example.tasks.api.spring.ListTasks;
import com.example.tasks.api.spring.SearchTasks;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.web.bind.annotation.RestController;

/** The `tasks` api's controllers: one declared success per operation, unless the loaded script answers. */
final class TasksControllers {
    private static final String API = "tasks";
    private static final String NEXT_CURSOR = "page-2";
    private static final UUID GENERAL_CHANNEL_ID = UUID.fromString("10000000-0000-4000-8000-000000000001");

    private TasksControllers() {}

    @RestController
    @SkippedUnder("missing-handler")
    static final class App implements AppEndpoints {
        private final ScriptedAnswers answers;

        App(ScriptedAnswers answers) {
            this.answers = answers;
        }

        @Override
        @com.example.tasks.api.spring.Health
        public HealthResult health(HealthInput input) {
            return answers.answer(API, "health", 200, Health.class, HealthResult.Status200::new, Map.<String, java.util.function.Supplier<HealthResult>>of())
                    .orElseGet(() -> new HealthResult.Status200(new Health("ok")));
        }
    }

    @RestController
    static final class Channels implements ChannelsEndpoints {
        private final ScriptedAnswers answers;

        Channels(ScriptedAnswers answers) {
            this.answers = answers;
        }

        @Override
        @ListChannels
        public ListChannelsResult listChannels(ListChannelsInput input) {
            return new ListChannelsResult.Status200(new ListChannelsPage(List.of(new Channel(GENERAL_CHANNEL_ID, "General")), Optional.empty()));
        }

        @Override
        @GetChannel
        public GetChannelResult getChannel(GetChannelInput input) {
            return answers.answer(API, "getChannel", 200, Channel.class, GetChannelResult.Status200::new, Map.<String, java.util.function.Supplier<GetChannelResult>>of())
                    .orElseGet(() -> new GetChannelResult.Status200(new Channel(input.path().channelId(), "General")));
        }
    }

    @RestController
    static final class Drafts implements DraftsEndpoints {
        @Override
        @GetDraft
        public GetDraftResult getDraft(GetDraftInput input) {
            return new GetDraftResult.Status200(new Draft(input.path().draftId(), "Draft text"));
        }

        @Override
        @DeleteDraft
        public DeleteDraftResult deleteDraft(DeleteDraftInput input) {
            return new DeleteDraftResult.Status200(new Draft(input.path().draftId(), "Draft text"));
        }
    }

    @RestController
    static final class Tasks implements TasksEndpoints {
        private final ScriptedAnswers answers;

        Tasks(ScriptedAnswers answers) {
            this.answers = answers;
        }

        @Override
        @GetTask
        public GetTaskResult getTask(GetTaskInput input) {
            return answers.answer(API, "getTask", 200, Task.class, GetTaskResult.Status200::new,
                            Map.<String, java.util.function.Supplier<GetTaskResult>>of("api.not_found", GetTaskErrors.ApiNotFound::new))
                    .orElseGet(() -> new GetTaskResult.Status200(SampleData.task(input.path().taskId())));
        }

        @Override
        @ListTasks
        public ListTasksResult listTasks(ListTasksInput input) {
            // The first page links a second one; the second is the last.
            Optional<String> nextCursor = input.query().cursor().isPresent() ? Optional.empty() : Optional.of(NEXT_CURSOR);

            return answers.answer(API, "listTasks", 200, ListTasksPage.class, ListTasksResult.Status200::new, Map.<String, java.util.function.Supplier<ListTasksResult>>of())
                    .orElseGet(() -> new ListTasksResult.Status200(new ListTasksPage(List.of(SampleData.task(SampleData.NEW_TASK_ID)), nextCursor)));
        }

        @Override
        @GetTasksBatch
        public GetTasksBatchResult getTasksBatch(GetTasksBatchInput input) {
            Map<String, Task> tasks = new LinkedHashMap<>();
            for (UUID taskId : input.body().ids()) tasks.put(taskId.toString(), SampleData.task(taskId));

            return new GetTasksBatchResult.Status200(tasks);
        }

        @Override
        @SearchTasks
        public SearchTasksResult searchTasks(SearchTasksInput input) {
            return new SearchTasksResult.Status200(new TaskSearchResult(List.of(SampleData.task(SampleData.NEW_TASK_ID)), Optional.of(1L)));
        }
    }
}
