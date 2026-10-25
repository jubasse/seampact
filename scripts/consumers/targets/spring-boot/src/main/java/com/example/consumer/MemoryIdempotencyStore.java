package com.example.consumer;

import io.github.jubasse.seampact.hooks.IdempotencyBegin;
import io.github.jubasse.seampact.hooks.IdempotencyClaim;
import io.github.jubasse.seampact.hooks.IdempotencyStore;
import io.github.jubasse.seampact.hooks.StoredResponse;
import java.util.HashMap;
import java.util.Map;
import org.springframework.stereotype.Component;

/** The app's idempotency store for the suite: one process's memory, entries kept for their lifetime. */
@Component
final class MemoryIdempotencyStore implements IdempotencyStore {
    private record Entry(String fingerprint, long expiresAtMs, StoredResponse response) {}

    private final Map<String, Entry> entries = new HashMap<>();

    @Override
    public synchronized IdempotencyBegin begin(IdempotencyClaim claim) {
        long nowMs = System.currentTimeMillis();
        entries.values().removeIf(entry -> entry.response() != null && entry.expiresAtMs() <= nowMs);

        Entry existing = entries.get(claim.key());
        if (existing == null) {
            entries.put(claim.key(), new Entry(claim.fingerprint(), nowMs + claim.lifetimeMs(), null));
            return new IdempotencyBegin.Started();
        }

        if (!existing.fingerprint().equals(claim.fingerprint())) return new IdempotencyBegin.Mismatch();
        if (existing.response() == null) return new IdempotencyBegin.Running();

        return new IdempotencyBegin.Replay(existing.response());
    }

    @Override
    public synchronized void complete(String key, StoredResponse response) {
        Entry running = entries.get(key);
        if (running != null) entries.put(key, new Entry(running.fingerprint(), running.expiresAtMs(), response));
    }

    @Override
    public synchronized void abandon(String key) {
        entries.remove(key);
    }
}
