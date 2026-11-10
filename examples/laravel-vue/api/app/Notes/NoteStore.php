<?php

declare(strict_types=1);

namespace App\Notes;

use App\Generated\Notes\Schemas\Note;
use DateTimeImmutable;
use Illuminate\Support\Str;

/** Keeps the notes in one JSON file, since each request of PHP's built-in server starts from nothing. */
final class NoteStore
{
    /** @return list<Note> */
    public function all(): array
    {
        return array_map($this->toNote(...), $this->read());
    }

    public function find(string $noteId): ?Note
    {
        foreach ($this->all() as $note) {
            if ($note->noteId === $noteId) {
                return $note;
            }
        }

        return null;
    }

    public function add(string $title, ?string $body): Note
    {
        $row = [
            'noteId' => (string) Str::uuid(),
            'title' => $title,
            'body' => $body,
            'createdAt' => (new DateTimeImmutable())->format(DATE_ATOM),
        ];

        $this->write([...$this->read(), $row]);

        return $this->toNote($row);
    }

    public function delete(string $noteId): bool
    {
        $rows = $this->read();
        $kept = array_values(array_filter($rows, static fn (array $row): bool => $row['noteId'] !== $noteId));

        $this->write($kept);

        return count($kept) < count($rows);
    }

    /** @return list<array{noteId: string, title: string, body: ?string, createdAt: string}> */
    private function read(): array
    {
        if (!is_file($this->file())) {
            return [];
        }

        /** @var list<array{noteId: string, title: string, body: ?string, createdAt: string}> */
        return json_decode((string) file_get_contents($this->file()), true, flags: JSON_THROW_ON_ERROR);
    }

    /** @param list<array{noteId: string, title: string, body: ?string, createdAt: string}> $rows */
    private function write(array $rows): void
    {
        file_put_contents($this->file(), json_encode($rows, JSON_THROW_ON_ERROR), LOCK_EX);
    }

    private function file(): string
    {
        return storage_path('notes.json');
    }

    /** @param array{noteId: string, title: string, body: ?string, createdAt: string} $row */
    private function toNote(array $row): Note
    {
        return new Note($row['noteId'], $row['title'], $row['body'], new DateTimeImmutable($row['createdAt']));
    }
}
