<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

/**
 * One named reason to refuse an IR. `member` is the JSON Pointer of the refused value. `operation` is the id of
 * the operation it is in, null outside one and for `ir.nesting.too-deep`, which refuses before reading anything.
 * `value` and `expected` by code:
 * - version, revision, kind, feature and must-act: `value` is the refused value (a string as is, a number in
 *   plain form, an array or object by its JSON type, an absent one `missing`), `expected` the values the reader
 *   accepts.
 * - `ir.support.malformed`: `value` is the JSON type found, `expected` is `['array']`.
 * - `ir.nesting.too-deep`: `value` is the depth reached, the bound plus one; `expected` is the bound. `member` is
 *   the first array or object past the bound in document order.
 * `message` cuts every untrusted string; the other members keep it whole.
 */
final readonly class IrRefusal
{
    /** @param list<string> $expected */
    public function __construct(
        public IrRefusalCode $code,
        public string $member,
        public string $value,
        public array $expected,
        public ?string $operation,
        public string $message,
    ) {
    }
}
