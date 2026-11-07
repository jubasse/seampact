package com.example.consumer;

import com.example.taskssplitsort.api.ListNotesInput;
import com.example.taskssplitsort.api.ListNotesPage;
import com.example.taskssplitsort.api.ListNotesResult;
import com.example.taskssplitsort.api.NotesEndpoints;
import com.example.taskssplitsort.api.schemas.Note;
import com.example.taskssplitsort.api.spring.ListNotes;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.UUID;
import org.springframework.web.bind.annotation.RestController;

/** The `tasksSplitSort` api's controller: GitHub-style pages whose note's text tells the sort and the page size received. */
@RestController
final class TasksSplitSortControllers implements NotesEndpoints {
    private static final UUID FIRST_NOTE_ID = UUID.fromString("30000000-0000-4000-8000-000000000001");
    private static final OffsetDateTime CREATED = OffsetDateTime.parse("2026-10-18T09:00:00Z");
    // Three pages of 100, so a page size above the maximum served as sent would link no next page.
    private static final long TOTAL = 250;

    @Override
    @ListNotes
    public ListNotesResult listNotes(ListNotesInput input) {
        String text = input.query().sort().orElse("none") + " " + input.query().direction().orElse("none") + ", "
                + input.query().perPage().map(String::valueOf).orElse("none") + " per page";

        return new ListNotesResult.Status200(new ListNotesPage(List.of(new Note(FIRST_NOTE_ID, text, CREATED)), TOTAL));
    }
}
