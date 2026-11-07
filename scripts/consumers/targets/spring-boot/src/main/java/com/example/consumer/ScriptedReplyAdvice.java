package com.example.consumer;

import java.util.Map;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

/** The app's own advice writing a scripted reply; the boundary checks it like any reply on a contract route. */
@RestControllerAdvice
class ScriptedReplyAdvice {
    @ExceptionHandler(ScriptedAnswers.ScriptedReply.class)
    ResponseEntity<Object> scripted(ScriptedAnswers.ScriptedReply reply) {
        if (reply.code.isEmpty()) return ResponseEntity.status(reply.status).contentType(MediaType.APPLICATION_JSON).body(reply.body);

        return ResponseEntity.status(reply.status)
                .contentType(MediaType.APPLICATION_PROBLEM_JSON)
                .body(Map.of("code", reply.code, "status", reply.status));
    }
}
