<?php

declare(strict_types=1);

namespace Seampact\Ir\Write;

/** A write whose checks all passed, not yet done: what `GeneratedWriter::commit` writes, keeps and removes. */
final readonly class PlannedWrite
{
    /**
     * @param array<string, string> $bytesByPath each planned file's bytes, in code-unit order of path
     * @param list<string> $unchanged the planned paths whose bytes are on disk already
     * @param list<string> $removable the paths a previous run generated that this one does not
     */
    public function __construct(
        public string $rootDir,
        public string $owner,
        public array $bytesByPath,
        public array $unchanged,
        public array $removable,
    ) {
    }

    /**
     * The paths a commit writes: each planned file whose bytes differ from the file on disk, or that is missing.
     *
     * @return list<string>
     */
    public function changed(): array
    {
        return array_values(array_diff(array_map(strval(...), array_keys($this->bytesByPath)), $this->unchanged));
    }
}
