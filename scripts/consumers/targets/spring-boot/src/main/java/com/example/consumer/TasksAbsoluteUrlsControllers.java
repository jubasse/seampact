package com.example.consumer;

import com.example.tasksabsoluteurls.api.GetNoteInput;
import com.example.tasksabsoluteurls.api.GetNoteResult;
import com.example.tasksabsoluteurls.api.ListNotesInput;
import com.example.tasksabsoluteurls.api.ListNotesResult;
import com.example.tasksabsoluteurls.api.NotesEndpoints;
import com.example.tasksabsoluteurls.api.spring.GetNote;
import com.example.tasksabsoluteurls.api.spring.ListNotes;
import org.springframework.web.bind.annotation.RestController;

/** The `tasksAbsoluteUrls` api's controller; the boundary writes its page links from the configured public origin. */
@RestController
final class TasksAbsoluteUrlsControllers implements NotesEndpoints {
    @Override
    @ListNotes
    public ListNotesResult listNotes(ListNotesInput input) {
        return PagedLists.listNotes(input);
    }

    @Override
    @GetNote
    public GetNoteResult getNote(GetNoteInput input) {
        return new GetNoteResult.Status200(SampleData.note(input.path().noteId()));
    }
}
