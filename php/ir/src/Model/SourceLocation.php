<?php

// Generated from packages/core/spec/schemas/ir by scripts/ir-models for IR revision 2. Do not edit.
// Regenerate: node --import ./scripts/ir-models/register.ts scripts/ir-models/cli.ts --write

declare(strict_types=1);

namespace Seampact\Ir\Model;

/** A location in a source file. */
final readonly class SourceLocation
{
    /**
     * @param string $file Relative to the workspace root, with forward slashes: never absolute, no '.' or '..' segment, no backslash or ':'.
     * @param int $line
     * @param int $column
     * @param int $endLine
     * @param int $endColumn
     */
    public function __construct(
        public string $file,
        public int $line,
        public int $column,
        public int $endLine,
        public int $endColumn,
    ) {
    }

    public static function fromJson(mixed $value): self
    {
        $members = IrHydration::object($value, 'SourceLocation');

        return new self(
            file: IrHydration::string(IrHydration::required($members, 'file', 'SourceLocation'), 'SourceLocation.file'),
            line: IrHydration::integer(IrHydration::required($members, 'line', 'SourceLocation'), 'SourceLocation.line'),
            column: IrHydration::integer(IrHydration::required($members, 'column', 'SourceLocation'), 'SourceLocation.column'),
            endLine: IrHydration::integer(IrHydration::required($members, 'endLine', 'SourceLocation'), 'SourceLocation.endLine'),
            endColumn: IrHydration::integer(IrHydration::required($members, 'endColumn', 'SourceLocation'), 'SourceLocation.endColumn'),
        );
    }

    public function toJson(): \stdClass
    {
        $json = new \stdClass();
        $json->{'file'} = $this->file;
        $json->{'line'} = $this->line;
        $json->{'column'} = $this->column;
        $json->{'endLine'} = $this->endLine;
        $json->{'endColumn'} = $this->endColumn;
        return $json;
    }
}
