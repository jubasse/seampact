<?php

declare(strict_types=1);

namespace Seampact\Ir\Read;

use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelException;

/**
 * Reads an IR document into the generated model. Before anything is parsed or hydrated it checks, in order: the
 * nesting depth of the whole document (`ir.nesting.too-deep`, alone, past 256 arrays and objects); `irVersion`
 * and `irRevision` and the declaration kinds and features the reader supports (the codes of `checkIrSupport`);
 * then the unknown tags and values of must-act definitions. Every other unknown member, tag and value is
 * tolerated: members are dropped, tags and values are kept as `Unknown`.
 *
 * The reader bounds its own work and output: nesting depth, at most 100 refusals per check, and every untrusted
 * string cut in a message. A refusal still keeps its pointer and operation id whole, so callers bound the size
 * of the input they read.
 */
final class IrReader
{
    // The cause's message can quote untrusted input: the exception's own message keeps this much of it.
    private const MAX_CAUSE_MESSAGE_LENGTH = 400;

    // The nesting scan already refused anything past 256 levels, and json_decode counts its depth by an
    // implementation detail that differs by one between PHP versions: it is given room, not a bound.
    private const PARSER_DEPTH = 512;

    /**
     * @throws IrRefusedException the IR is nested too deep, or not one `$support` reads or acts on safely
     * @throws IrMalformedException the text is not JSON or not an IR
     */
    public static function read(string $text, IrSupport $support): ContractIR
    {
        self::refuseIfPresent(NestingCheck::checkText($text));

        return self::readWithinNestingBound(self::parse($text), $support);
    }

    /**
     * Reads the output of `json_decode($text)` with objects as `stdClass` (not the associative mode).
     *
     * @see read
     */
    public static function readDocument(mixed $document, IrSupport $support): ContractIR
    {
        if (self::isAssociativeObject($document)) {
            throw new IrMalformedException('The IR document must be decoded with objects as stdClass: json_decode($text, false).');
        }

        self::refuseIfPresent(NestingCheck::checkDocument($document));

        return self::readWithinNestingBound($document, $support);
    }

    private static function readWithinNestingBound(mixed $document, IrSupport $support): ContractIR
    {
        self::refuseUnlessEmpty(SupportCheck::check($document, $support));
        self::refuseUnlessEmpty(MustActCheck::check($document));

        try {
            return ContractIR::fromJson($document);
        } catch (IrModelException $error) {
            throw new IrMalformedException(
                'The IR does not match the IR model: ' . self::causeOf($error),
                previous: $error,
            );
        }
    }

    // A list root stays as it is, for parity with `read('[...]')`; only a keyed array shows the wrong decode mode.
    private static function isAssociativeObject(mixed $document): bool
    {
        return is_array($document) && !array_is_list($document);
    }

    private static function parse(string $text): mixed
    {
        try {
            return json_decode($text, false, self::PARSER_DEPTH, JSON_THROW_ON_ERROR);
        } catch (\JsonException $error) {
            throw new IrMalformedException('The IR is not JSON: ' . self::causeOf($error), previous: $error);
        }
    }

    private static function causeOf(\Throwable $error): string
    {
        return RefusalText::inMessage($error->getMessage(), self::MAX_CAUSE_MESSAGE_LENGTH);
    }

    private static function refuseIfPresent(?IrRefusal $refusal): void
    {
        if ($refusal !== null) {
            throw new IrRefusedException([$refusal]);
        }
    }

    /** @param list<IrRefusal> $refusals */
    private static function refuseUnlessEmpty(array $refusals): void
    {
        if ($refusals !== []) {
            throw new IrRefusedException($refusals);
        }
    }
}
