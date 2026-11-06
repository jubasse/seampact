package com.example.consumer;

import com.example.tasksresponses.api.ApiPreconditionFailedError;
import com.example.tasksresponses.api.DigestInput;
import com.example.tasksresponses.api.DigestResult;
import com.example.tasksresponses.api.GetNoteInput;
import com.example.tasksresponses.api.GetNoteResult;
import com.example.tasksresponses.api.KeyNoteInput;
import com.example.tasksresponses.api.KeyNoteResult;
import com.example.tasksresponses.api.LegacyNoteInput;
import com.example.tasksresponses.api.LegacyNoteResult;
import com.example.tasksresponses.api.NotesEndpoints;
import com.example.tasksresponses.api.ResponsesEndpoints;
import com.example.tasksresponses.api.SaveNoteInput;
import com.example.tasksresponses.api.SaveNoteResult;
import com.example.tasksresponses.api.UpdateNoteInput;
import com.example.tasksresponses.api.UpdateNoteResult;
import com.example.tasksresponses.api.schemas.Note;
import com.example.tasksresponses.api.schemas.NoteKey;
import com.example.tasksresponses.api.spring.Digest;
import com.example.tasksresponses.api.spring.GetNote;
import com.example.tasksresponses.api.spring.KeyNote;
import com.example.tasksresponses.api.spring.LegacyNote;
import com.example.tasksresponses.api.spring.SaveNote;
import com.example.tasksresponses.api.spring.UpdateNote;
import java.util.Map;
import java.util.UUID;
import java.util.function.Supplier;
import org.springframework.web.bind.annotation.RestController;

/**
 * The `tasksResponses` api's controllers: one note at its first revision, saved as 200 when it exists and 201
 * otherwise, and the If-Match comparison the boundary leaves to the handler.
 */
final class TasksResponsesControllers {
    private static final String API = "tasksResponses";
    private static final UUID NOTE_ID = UUID.fromString("30000000-0000-4000-8000-000000000001");
    private static final long FIRST_REVISION = 1;
    private static final String FIRST_NOTE_TEXT = "The first note";
    private static final String NOTE_SECRET = "note-secret";

    private TasksResponsesControllers() {}

    @RestController
    static final class Responses implements ResponsesEndpoints {
        @Override
        @Digest
        public DigestResult digest(DigestInput input) {
            return new DigestResult.Status200(new Note(NOTE_ID, "Today's digest", FIRST_REVISION));
        }
    }

    @RestController
    static final class Notes implements NotesEndpoints {
        private final ScriptedAnswers answers;

        Notes(ScriptedAnswers answers) {
            this.answers = answers;
        }

        @Override
        @GetNote
        public GetNoteResult getNote(GetNoteInput input) {
            return new GetNoteResult.Status200(new Note(input.path().noteId(), FIRST_NOTE_TEXT, FIRST_REVISION));
        }

        @Override
        @UpdateNote
        public UpdateNoteResult updateNote(UpdateNoteInput input) throws ApiPreconditionFailedError {
            // The boundary hands the If-Match version unquoted (`1` for `"1"` or `W/"1"`).
            if (!String.valueOf(FIRST_REVISION).equals(input.headers().ifMatch())) throw new ApiPreconditionFailedError();

            return new UpdateNoteResult.Status200(new Note(input.path().noteId(), input.body().text(), FIRST_REVISION + 1));
        }

        @Override
        @SaveNote
        public SaveNoteResult saveNote(SaveNoteInput input) {
            Note saved = new Note(input.path().noteId(), input.body().text(), FIRST_REVISION);

            return NOTE_ID.equals(input.path().noteId()) ? new SaveNoteResult.Status200(saved) : new SaveNoteResult.Status201(saved);
        }

        @Override
        @KeyNote
        public KeyNoteResult keyNote(KeyNoteInput input) {
            return answers.answer(API, "keyNote", 200, NoteKey.class, KeyNoteResult.Status200::new, Map.<String, Supplier<KeyNoteResult>>of())
                    .orElseGet(() -> new KeyNoteResult.Status200(new NoteKey(input.path().noteId(), NOTE_SECRET)));
        }

        @Override
        @LegacyNote
        public LegacyNoteResult legacyNote(LegacyNoteInput input) {
            return new LegacyNoteResult.Status200(new Note(input.path().noteId(), FIRST_NOTE_TEXT, FIRST_REVISION));
        }
    }
}
