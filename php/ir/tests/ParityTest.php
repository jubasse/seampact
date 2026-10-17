<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Read\IrMalformedException;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Read\IrRefusal;
use Seampact\Ir\Read\IrRefusedException;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Tests\Support\Documents;
use Seampact\Ir\Tests\Support\Json;

// The reader parity corpus (ADR 0010): for every case of `packages/core/spec/vectors/ir/cases.json` this reader gives
// the verdict of the TypeScript reader, and names the same codes and members. The message text is never compared.
final class ParityTest extends TestCase
{
    private const ACCEPT = 'accept';

    private const MALFORMED = 'malformed';

    private const NOT_JSON = 'not-json';

    private const REFUSE = 'refuse';

    private function corpus(): \stdClass
    {
        return Json::object(Json::decodeFile(Documents::repositoryRoot() . '/packages/core/spec/vectors/ir/cases.json'));
    }

    private function supportNamed(\stdClass $corpus, string $name): IrSupport
    {
        $declared = Json::object(Json::member(Json::object(Json::member($corpus, 'supports')), $name));

        return new IrSupport(
            array_map(static function (mixed $version): int {
                self::assertIsInt($version);

                return $version;
            }, Json::list(Json::member($declared, 'irVersions'))),
            Json::int($declared, 'irRevision'),
            Json::strings($declared, 'kinds'),
            Json::strings($declared, 'features'),
        );
    }

    /** @return list<string> */
    private function pointerSegments(string $pointer): array
    {
        return array_map(
            static fn (string $segment): string => str_replace(['~1', '~0'], ['/', '~'], $segment),
            array_slice(explode('/', $pointer), 1),
        );
    }

    private function literalPlaceholder(int $index): string
    {
        return "literal-placeholder-$index";
    }

    private function documentTextOf(\stdClass $case): string
    {
        $document = Documents::example(Json::string($case, 'example'));

        foreach (Json::optionalObjects($case, 'edits') as $edit) {
            $path = $this->pointerSegments(Json::string($edit, 'pointer'));
            $document = Json::has($edit, 'remove')
                ? Documents::withoutMember($document, array_slice($path, 0, -1), (string) end($path))
                : Documents::replaceAt($document, $path, Json::member($edit, 'value'));
        }

        $literals = Json::optionalObjects($case, 'literals');

        foreach ($literals as $index => $literal) {
            $document = Documents::replaceAt(
                $document,
                $this->pointerSegments(Json::string($literal, 'pointer')),
                $this->literalPlaceholder($index),
            );
        }

        $text = json_encode($document, JSON_THROW_ON_ERROR);

        foreach ($literals as $index => $literal) {
            $text = str_replace('"' . $this->literalPlaceholder($index) . '"', Json::string($literal, 'text'), $text);
        }

        return $text;
    }

    /** @return array{string, list<IrRefusal>} the outcome, with the refusals sorted as the corpus sorts them */
    private function verdictOf(string $text, IrSupport $support): array
    {
        try {
            IrReader::read($text, $support);
        } catch (IrRefusedException $refused) {
            $refusals = $refused->refusals;
            usort(
                $refusals,
                static fn (IrRefusal $left, IrRefusal $right): int
                    => [$left->member, $left->code->value] <=> [$right->member, $right->code->value],
            );

            return [self::REFUSE, $refusals];
        } catch (IrMalformedException) {
            return [self::MALFORMED, []];
        }

        return [self::ACCEPT, []];
    }

    // Each field the corpus records; a support refusal, the one with an expected list, has its operation compared too.
    private function refusalAgrees(\stdClass $expected, IrRefusal $actual): bool
    {
        $expectedList = Json::has($expected, 'expected') ? Json::strings($expected, 'expected') : null;

        return Json::string($expected, 'code') === $actual->code->value
            && Json::string($expected, 'member') === $actual->member
            && (Json::optionalString($expected, 'value') ?? $actual->value) === $actual->value
            && ($expectedList ?? $actual->expected) === $actual->expected
            && ($expectedList === null || Json::optionalString($expected, 'operation') === $actual->operation);
    }

    /** @param array{string, list<IrRefusal>} $actual */
    private function agrees(\stdClass $verdict, array $actual): bool
    {
        $outcome = Json::string($verdict, 'outcome');

        // Text that is not JSON is malformed for every reader.
        if ($outcome === self::NOT_JSON) {
            return $actual[0] === self::MALFORMED;
        }

        $expectedRefusals = Json::optionalObjects($verdict, 'refusals');

        if ($outcome !== $actual[0] || count($expectedRefusals) !== count($actual[1])) {
            return false;
        }

        foreach ($expectedRefusals as $index => $expected) {
            if (!$this->refusalAgrees($expected, $actual[1][$index])) {
                return false;
            }
        }

        return true;
    }

    public function testMatchesTypeScriptVerdicts(): void
    {
        $corpus = $this->corpus();
        $cases = Json::objects($corpus, 'cases');
        self::assertGreaterThan(50, count($cases));
        $mismatches = [];

        foreach ($cases as $case) {
            $verdict = Json::object(Json::member($case, 'verdict'));
            $actual = $this->verdictOf($this->documentTextOf($case), $this->supportNamed($corpus, Json::string($case, 'support')));

            if (!$this->agrees($verdict, $actual)) {
                $mismatches[] = Json::string($case, 'id') . ': expected ' . json_encode($verdict) . ', got ' . json_encode($actual);
            }
        }

        self::assertSame([], $mismatches);
    }

    public function testTheCorpusIsBuiltForThisRevision(): void
    {
        self::assertSame(IrModelVersion::IR_REVISION, Json::int($this->corpus(), 'irRevision'));
    }
}
