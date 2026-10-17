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

    /** @return array{string, list<array{string, string}>} */
    private function verdictOf(string $text, IrSupport $support): array
    {
        try {
            IrReader::read($text, $support);
        } catch (IrRefusedException $refused) {
            $refusals = array_map(
                static fn (IrRefusal $refusal): array => [$refusal->code->value, $refusal->member],
                $refused->refusals,
            );
            usort($refusals, static fn (array $left, array $right): int => [$left[1], $left[0]] <=> [$right[1], $right[0]]);

            return [self::REFUSE, $refusals];
        } catch (IrMalformedException) {
            return [self::MALFORMED, []];
        }

        return [self::ACCEPT, []];
    }

    /** @return list<array{string, string}> */
    private function expectedRefusals(\stdClass $verdict): array
    {
        return array_map(
            static fn (\stdClass $refusal): array => [Json::string($refusal, 'code'), Json::string($refusal, 'member')],
            Json::optionalObjects($verdict, 'refusals'),
        );
    }

    public function testMatchesTypeScriptVerdicts(): void
    {
        $corpus = $this->corpus();
        $cases = Json::objects($corpus, 'cases');
        self::assertGreaterThan(50, count($cases));
        $mismatches = [];

        foreach ($cases as $case) {
            $verdict = Json::object(Json::member($case, 'verdict'));
            $expected = [Json::string($verdict, 'outcome'), $this->expectedRefusals($verdict)];
            $actual = $this->verdictOf($this->documentTextOf($case), $this->supportNamed($corpus, Json::string($case, 'support')));
            // Text that is not JSON is never accepted; the TypeScript reader calls it malformed, as this one does.
            $agrees = $expected[0] === self::NOT_JSON ? $actual[0] === self::MALFORMED : $expected === $actual;

            if (!$agrees) {
                $mismatches[] = Json::string($case, 'id') . ': expected ' . json_encode($expected) . ', got ' . json_encode($actual);
            }
        }

        self::assertSame([], $mismatches);
    }

    public function testTheCorpusIsBuiltForThisRevision(): void
    {
        self::assertSame(IrModelVersion::IR_REVISION, Json::int($this->corpus(), 'irRevision'));
    }
}
