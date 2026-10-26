<?php

declare(strict_types=1);

namespace Seampact\Laravel;

/** The PHP names of one operation: its handler method and the classes the target writes for it. */
final readonly class OperationNames
{
    /** @param array<int, string> $responses each declared success status and its result class */
    public function __construct(
        public string $method,
        public string $input,
        public string $path,
        public string $query,
        public string $headers,
        public string $result,
        public string $errors,
        public string $request,
        public string $endpoints,
        public array $responses,
    ) {
    }
}
