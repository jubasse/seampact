package com.example.consumer;

import com.example.taskspaging.api.CappedEndpoints;
import com.example.taskspaging.api.ChangesEndpoints;
import com.example.taskspaging.api.EventsEndpoints;
import com.example.taskspaging.api.ListCappedInput;
import com.example.taskspaging.api.ListCappedPage;
import com.example.taskspaging.api.ListCappedResult;
import com.example.taskspaging.api.ListChangesErrors;
import com.example.taskspaging.api.ListChangesInput;
import com.example.taskspaging.api.ListChangesPage;
import com.example.taskspaging.api.ListChangesResult;
import com.example.taskspaging.api.ListEventsInput;
import com.example.taskspaging.api.ListEventsPage;
import com.example.taskspaging.api.ListEventsResult;
import com.example.taskspaging.api.ListNotesInput;
import com.example.taskspaging.api.ListNotesPage;
import com.example.taskspaging.api.ListNotesResult;
import com.example.taskspaging.api.NotesEndpoints;
import com.example.taskspaging.api.schemas.Note;
import com.example.taskspaging.api.spring.ListCapped;
import com.example.taskspaging.api.spring.ListChanges;
import com.example.taskspaging.api.spring.ListEvents;
import com.example.taskspaging.api.spring.ListNotes;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.web.bind.annotation.RestController;

/**
 * The `tasksPaging` api's controllers: a changes feed with its next token, a stale token and an instant one, and a
 * Stripe-style list with its more flag, and a clamped list that reports its limit. A note's text tells what the handler
 * received, so a case reads it on the wire.
 */
@RestController
final class TasksPagingControllers implements NotesEndpoints, ChangesEndpoints, EventsEndpoints, CappedEndpoints {
    private static final UUID FIRST_NOTE_ID = UUID.fromString("30000000-0000-4000-8000-000000000001");
    private static final UUID SECOND_NOTE_ID = UUID.fromString("30000000-0000-4000-8000-000000000002");
    private static final String NEXT_CHANGES_TOKEN = "changes-2";
    private static final String NEXT_EVENTS_INSTANT = "2026-10-18T10:00:00Z";

    @Override
    @ListNotes
    public ListNotesResult listNotes(ListNotesInput input) {
        if (input.query().endingBefore().equals(Optional.of(SECOND_NOTE_ID.toString()))) {
            return new ListNotesResult.Status200(new ListNotesPage(List.of(new Note(FIRST_NOTE_ID, "Before the second note")), false));
        }

        if (input.query().startingAfter().equals(Optional.of(FIRST_NOTE_ID.toString()))) {
            return new ListNotesResult.Status200(new ListNotesPage(List.of(new Note(SECOND_NOTE_ID, "Second note")), false));
        }

        return new ListNotesResult.Status200(new ListNotesPage(List.of(new Note(FIRST_NOTE_ID, "First note")), true));
    }

    @Override
    @ListChanges
    public ListChangesResult listChanges(ListChangesInput input) {
        Optional<String> since = input.query().since();

        if (since.equals(Optional.of(NEXT_CHANGES_TOKEN))) {
            return new ListChangesResult.Status200(new ListChangesPage(List.of(), true, NEXT_CHANGES_TOKEN));
        }

        // A token the feed no longer serves answers the `gone` role's code.
        if (since.isPresent()) return new ListChangesErrors.ApiCursorTooOld();

        String limit = input.query().limit().map(String::valueOf).orElse("none");

        return new ListChangesResult.Status200(new ListChangesPage(List.of(new Note(FIRST_NOTE_ID, "limit " + limit)), false, NEXT_CHANGES_TOKEN));
    }

    @Override
    @ListEvents
    public ListEventsResult listEvents(ListEventsInput input) {
        String since = input.query().since().map(DateTimeFormatter.ISO_INSTANT::format).orElse("none");

        return new ListEventsResult.Status200(
                new ListEventsPage(List.of(new Note(FIRST_NOTE_ID, "since " + since)), true, NEXT_EVENTS_INSTANT));
    }

    @Override
    @ListCapped
    public ListCappedResult listCapped(ListCappedInput input) {
        String limit = input.query().limit().map(String::valueOf).orElse("none");

        return new ListCappedResult.Status200(new ListCappedPage(List.of(new Note(FIRST_NOTE_ID, "limit " + limit)), false));
    }
}
