<?php

declare(strict_types=1);

namespace App\Rules;

use App\Generated\Notes\Laravel\NotesInputRules;

/** The app's rules on the body of `createNote`: the one thing the contract cannot say. */
final class CreateNoteBodyRules implements NotesInputRules
{
    public function operationId(): string
    {
        return 'createNote';
    }

    public function part(): string
    {
        return 'body';
    }

    public function rules(): array
    {
        return ['title' => [new TitleNotBlank()]];
    }
}
