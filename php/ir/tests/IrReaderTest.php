<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Model\SchemaUnknown;
use Seampact\Ir\Read\IrMalformedException;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Read\IrRefusal;
use Seampact\Ir\Read\IrRefusalCode;
use Seampact\Ir\Read\IrRefusedException;
use Seampact\Ir\Read\IrSupport;
use Seampact\Ir\Read\MustActCheck;
use Seampact\Ir\Tests\Support\Deep;
use Seampact\Ir\Tests\Support\Documents;

// A refusal message with every untrusted string cut, and an exception message with its cause cut. The longest
// refusal message quotes three cut strings (value, pointer, operation id, 83 chars each) in about 150 chars of
// text: 600 leaves room for that and still fails on any uncut string of the 100,000 the tests use.
const REFUSAL_MESSAGE_BOUND = 600;
const EXCEPTION_MESSAGE_BOUND = 1000;

// A linear walk of the 10 MB document takes well under a second; a quadratic one takes many seconds.
const WALK_BUDGET_SECONDS = 3.0;

const MAX_REFUSALS = 100;

// The reader against the IR examples: the checks run on the raw document before hydration, with the codes of
// `checkIrSupport`, and a valid document reads and writes back unchanged up to the unknown members it drops.
final class IrReaderTest extends TestCase
{
    private IrSupport $support;

    protected function setUp(): void
    {
        $this->support = IrSupport::ofModel(kinds: ['httpOperation']);
    }

    /** @return list<IrRefusal> */
    private function refusals(\stdClass|string $document, ?IrSupport $support = null): array
    {
        try {
            $this->read($document, $support);
        } catch (IrRefusedException $refused) {
            return $refused->refusals;
        }
        self::fail('The IR was read, not refused.');
    }

    private function read(mixed $document, ?IrSupport $support = null): \Seampact\Ir\Model\ContractIR
    {
        $support ??= $this->support;

        return is_string($document)
            ? IrReader::read($document, $support)
            : IrReader::readDocument($document, $support);
    }

    /**
     * The document with `$deep` at `$path`, as text and as parsed value.
     *
     * @param list<string> $path
     * @return array{string, \stdClass}
     */
    private function bothWays(\stdClass $base, array $path, Deep $deep): array
    {
        $placeholder = Documents::replaceAt($base, $path, 'deep-placeholder');
        $text = str_replace('"deep-placeholder"', $deep->text, json_encode($placeholder, JSON_THROW_ON_ERROR));

        return [$text, Documents::replaceAt($base, $path, $deep->value)];
    }

    /** @param list<string> $path */
    private function readBothWays(\stdClass $base, array $path, Deep $deep): void
    {
        foreach ($this->bothWays($base, $path, $deep) as $document) {
            $this->read($document);
        }
        $this->addToAssertionCount(1);
    }

    /**
     * The single nesting refusal, the same from the text and from the parsed value.
     *
     * @param list<string> $path
     */
    private function nestingRefusal(\stdClass $base, array $path, Deep $deep): IrRefusal
    {
        [$text, $document] = $this->bothWays($base, $path, $deep);
        $fromText = $this->refusals($text);
        $fromDocument = $this->refusals($document);

        self::assertCount(1, $fromText);
        self::assertSame(IrRefusalCode::NestingTooDeep, $fromText[0]->code);
        self::assertEquals($fromText, $fromDocument);

        return $fromText[0];
    }

    public function testReadsExamples(): void
    {
        foreach (['minimal.ir.json', 'every-member.ir.json', 'unknown-enum-value.ir.json'] as $name) {
            $contract = IrReader::read(Documents::exampleText($name), $this->support);

            self::assertSame(
                Documents::canonical(Documents::example($name)),
                Documents::canonical($contract->toJson()),
                $name,
            );
        }
        $unknownMaturity = IrReader::read(Documents::exampleText('unknown-enum-value.ir.json'), $this->support);
        self::assertFalse($unknownMaturity->api->maturity->isKnown());
    }

    public function testDropsUnknownMembersOnly(): void
    {
        $input = Documents::example('unknown-member.ir.json');
        $expected = Documents::withoutMember($input, [], 'generatedBy');
        $expected = Documents::withoutMember($expected, ['api'], 'owner');
        $expected = Documents::withoutMember($expected, ['api', 'origin'], 'column');

        $written = IrReader::read(Documents::exampleText('unknown-member.ir.json'), $this->support)->toJson();

        self::assertSame(Documents::canonical($expected), Documents::canonical($written));
    }

    public function testKeepsUnknownSchemaKindRaw(): void
    {
        $input = Documents::example('unknown-kind.ir.json');

        $written = IrReader::read(Documents::exampleText('unknown-kind.ir.json'), $this->support)->toJson();

        self::assertSame(Documents::canonical(Documents::at($input, 'schemas')), Documents::canonical(Documents::at($written, 'schemas')));
    }

    public function testEmptyObjectsRoundTrip(): void
    {
        $written = json_encode(
            IrReader::read(Documents::exampleText('minimal.ir.json'), $this->support)->toJson(),
            JSON_THROW_ON_ERROR,
        );

        self::assertStringContainsString('"extensions":{}', $written);
        self::assertStringContainsString('"docs":{}', $written);
        self::assertStringContainsString('"schemas":{}', $written);
    }

    public function testRefusesOtherRevision(): void
    {
        $otherRevision = IrModelVersion::IR_REVISION + 6;
        $document = Documents::replaceAt(Documents::example('minimal.ir.json'), ['irRevision'], $otherRevision);

        $refusals = $this->refusals($document);

        self::assertCount(1, $refusals);
        self::assertSame(IrRefusalCode::RevisionMismatch, $refusals[0]->code);
        self::assertSame('/irRevision', $refusals[0]->member);
        self::assertSame('8', $refusals[0]->value);
        self::assertSame(['2'], $refusals[0]->expected);
        self::assertStringContainsString('seampact/ir', $refusals[0]->message);
        self::assertStringContainsString('(2)', $refusals[0]->message);
        self::assertStringContainsString('irRevision 8', $refusals[0]->message);
    }

    public function testRefusesOtherVersion(): void
    {
        // The rest of the document has another shape: nothing but the version is read, and it is named alone.
        $document = (object) ['irVersion' => 2, 'irRevision' => 9, 'kinds' => 'x'];

        $refusals = $this->refusals($document);

        self::assertCount(1, $refusals);
        self::assertSame(IrRefusalCode::VersionUnsupported, $refusals[0]->code);
        self::assertSame('/irVersion', $refusals[0]->member);
        self::assertSame('2', $refusals[0]->value);
        self::assertSame(['1'], $refusals[0]->expected);
        self::assertStringContainsString('seampact/ir', $refusals[0]->message);

        $notAnIr = IrReader::class;
        $this->expectRefusal(IrRefusalCode::VersionUnsupported, fn () => IrReader::readDocument('not an IR', $this->support));
        $this->expectRefusal(IrRefusalCode::VersionUnsupported, fn () => IrReader::readDocument(null, $this->support));
        self::assertSame('missing', $this->refusals(new \stdClass())[0]->value);
        self::assertSame('2', $this->refusals('{"irVersion": 2.0}')[0]->value);
        self::assertNotSame('', $notAnIr);
    }

    private function expectRefusal(IrRefusalCode $code, callable $read): void
    {
        try {
            $read();
        } catch (IrRefusedException $refused) {
            self::assertSame($code, $refused->refusals[0]->code);

            return;
        }
        self::fail('The IR was not refused.');
    }

    public function testRefusesUnknownKind(): void
    {
        $refused = $this->refusals(Documents::example('unknown-kind-and-feature.ir.json'));
        $kinds = array_values(array_filter($refused, static fn (IrRefusal $refusal): bool => $refusal->code === IrRefusalCode::KindUnsupported));

        self::assertCount(1, $kinds);
        self::assertSame('/kinds/1', $kinds[0]->member);
        self::assertSame('channel', $kinds[0]->value);
        self::assertSame(['httpOperation'], $kinds[0]->expected);
        self::assertSame("The declaration kind 'channel' is not supported by this reader.", $kinds[0]->message);

        $operationKind = Documents::replaceAt(Documents::example('every-member.ir.json'), ['operations', '1', 'kind'], 'channel');
        $refusal = $this->refusals($operationKind);
        self::assertCount(1, $refusal);
        self::assertSame('/operations/1/kind', $refusal[0]->member);
        self::assertSame('health', $refusal[0]->operation);
    }

    public function testRefusesUnknownFeature(): void
    {
        $refused = $this->refusals(Documents::example('unknown-kind-and-feature.ir.json'));
        $features = array_values(array_filter($refused, static fn (IrRefusal $refusal): bool => $refusal->code === IrRefusalCode::FeatureUnsupported));

        self::assertSame(['/features/0', '/operations/0/features/0'], array_map(static fn (IrRefusal $refusal): string => $refusal->member, $features));
        self::assertSame([null, 'health'], array_map(static fn (IrRefusal $refusal): ?string => $refusal->operation, $features));
        self::assertSame("The feature 'streaming' in operation 'health' is not supported by this reader.", $features[1]->message);
        self::assertSame(
            [IrRefusalCode::KindUnsupported, IrRefusalCode::FeatureUnsupported, IrRefusalCode::FeatureUnsupported],
            array_map(static fn (IrRefusal $refusal): IrRefusalCode => $refusal->code, $refused),
        );

        $declared = IrSupport::ofModel(kinds: ['httpOperation', 'channel'], features: ['streaming']);
        IrReader::read(Documents::exampleText('unknown-kind-and-feature.ir.json'), $declared);

        $malformed = Documents::replaceAt(Documents::example('minimal.ir.json'), ['features'], 'streaming');
        $refusal = $this->refusals($malformed);
        self::assertCount(1, $refusal);
        self::assertSame(IrRefusalCode::SupportMalformed, $refusal[0]->code);
        self::assertSame('string', $refusal[0]->value);
    }

    public function testRefusesUnknownMustAct(): void
    {
        $schemeKind = $this->refusals(Documents::example('unknown-must-act.ir.json'));

        self::assertCount(1, $schemeKind);
        self::assertSame(IrRefusalCode::MustActUnknown, $schemeKind[0]->code);
        self::assertSame('/schemes/client/kind', $schemeKind[0]->member);
        self::assertSame('mtls', $schemeKind[0]->value);
        self::assertNull($schemeKind[0]->operation);

        $inOperation = Documents::replaceAt(Documents::example('every-member.ir.json'), ['operations', '0', 'access', 'onRefused'], 'redirect');
        $unknownValue = $this->refusals($inOperation);
        self::assertCount(1, $unknownValue);
        self::assertSame('/operations/0/access/onRefused', $unknownValue[0]->member);
        self::assertSame('redirect', $unknownValue[0]->value);
        self::assertSame('getTask', $unknownValue[0]->operation);
        self::assertSame(['anonymous', 'reject'], $unknownValue[0]->expected);

        // A must-act union nested in an operation names the operation too.
        $unionInOperation = Documents::replaceAt(Documents::example('every-member.ir.json'), ['operations', '0', 'access', 'kind'], 'vault');
        $refusal = $this->refusals($unionInOperation);
        self::assertCount(1, $refusal);
        self::assertSame('/operations/0/access/kind', $refusal[0]->member);
    }

    public function testUnknownThatIsNotMustActIsKept(): void
    {
        // A refusal needs a must-act definition: an unknown schema kind and an unknown maturity are only kept.
        $schemas = IrReader::read(Documents::exampleText('unknown-kind.ir.json'), $this->support)->schemas;
        $point = $schemas['Point'];
        self::assertInstanceOf(SchemaUnknown::class, $point);
        self::assertSame('tuple', $point->tag());

        $maturity = IrReader::read(Documents::exampleText('unknown-enum-value.ir.json'), $this->support)->api->maturity;
        self::assertFalse($maturity->isKnown());
        self::assertSame(Documents::at(Documents::example('unknown-enum-value.ir.json'), 'api', 'maturity'), $maturity->value);
    }

    public function testHugeExponentVersionAndRevisionAreRefusedWithABoundedValue(): void
    {
        $version = $this->refusals('{"irVersion": 1e2147483647}');

        self::assertCount(1, $version);
        self::assertSame(IrRefusalCode::VersionUnsupported, $version[0]->code);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($version[0]->message));

        $revision = $this->refusals('{"irVersion": 1, "irRevision": 1e2147483647, "kinds": [], "features": [], "operations": []}');
        self::assertSame(IrRefusalCode::RevisionMismatch, $revision[0]->code);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($revision[0]->message));
    }

    public function testALongUntrustedValueIsCutInTheMessageOnly(): void
    {
        $tag = str_repeat('x', 100_000);
        $document = Documents::replaceAt(Documents::example('unknown-must-act.ir.json'), ['schemes', 'client', 'kind'], $tag);

        $refusals = $this->refusals($document);

        self::assertCount(1, $refusals);
        self::assertSame($tag, $refusals[0]->value);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($refusals[0]->message));
    }

    public function testALongOperationIdIsCutInEveryMessage(): void
    {
        $id = str_repeat('o', 100_000);
        $features = array_map(static fn (int $number): string => 'feature' . $number, range(0, 999));
        $withId = Documents::replaceAt(Documents::example('every-member.ir.json'), ['operations', '0', 'id'], $id);
        $unsupported = Documents::replaceAt(
            Documents::replaceAt($withId, ['operations', '0', 'features'], $features),
            ['operations', '0', 'kind'],
            'channel',
        );

        try {
            IrReader::readDocument($unsupported, $this->support);
            self::fail('The IR was read.');
        } catch (IrRefusedException $refused) {
            foreach ($refused->refusals as $refusal) {
                self::assertSame($id, $refusal->operation);
                self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($refusal->message));
            }
            self::assertLessThan(MAX_REFUSALS * REFUSAL_MESSAGE_BOUND, strlen($refused->getMessage()));
        }

        $mustAct = Documents::replaceAt($withId, ['operations', '0', 'access', 'onRefused'], 'redirect');
        $refusal = $this->refusals($mustAct);
        self::assertSame($id, $refusal[0]->operation);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($refusal[0]->message));
    }

    public function testRefusalsStopAtTheBound(): void
    {
        // A long key repeats in the pointer of every refusal below it: the count bounds that copy.
        $features = array_map(static fn (int $number): string => 'feature' . $number, range(0, 999));
        $unsupported = $this->refusals(Documents::replaceAt(Documents::example('minimal.ir.json'), ['features'], $features));

        self::assertCount(MAX_REFUSALS, $unsupported);
        self::assertSame('/features/99', $unsupported[99]->member);

        $mustAct = Documents::example('unknown-must-act.ir.json');
        $schemes = new \stdClass();
        for ($number = 0; $number < 1000; ++$number) {
            $schemes->{'client' . $number} = Documents::at($mustAct, 'schemes', 'client');
        }
        $unknowns = $this->refusals(Documents::replaceAt($mustAct, ['schemes'], $schemes));

        self::assertCount(MAX_REFUSALS, $unknowns);
        foreach ($unknowns as $unknown) {
            self::assertSame(IrRefusalCode::MustActUnknown, $unknown->code);
        }
    }

    public function testALongMapKeyKeepsTheMustActWalkLinear(): void
    {
        // The walk once copied the pointer for every node it visited: 400,000 chars times 40,000 properties.
        $everyMember = Documents::example('every-member.ir.json');
        $task = Documents::objectAt($everyMember, 'schemas', 'Task');
        $schema = Documents::replaceAt($task, ['properties'], array_fill(0, 40_000, Documents::at($task, 'properties', '0')));
        $schemas = new \stdClass();
        $schemas->{str_repeat('k', 400_000)} = $schema;
        $document = Documents::replaceAt($everyMember, ['schemas'], $schemas);

        $started = hrtime(true);
        $refusals = MustActCheck::check($document);
        $elapsed = (hrtime(true) - $started) / 1_000_000_000;

        self::assertSame([], $refusals);
        self::assertLessThan(WALK_BUDGET_SECONDS, $elapsed);
    }

    public function testDeepNestingIsRefusedBeforeAnyRecursion(): void
    {
        $places = [
            [['irVersion'], Deep::objects(800)],
            [['kinds', '0'], Deep::objects(800)],
            [['x'], Deep::arrays(2000)],
            [['api', 'version', 'number'], Deep::objects(3000)],
        ];
        $pathVersion = (object) ['kind' => 'path', 'number' => 1];
        $withPathVersion = Documents::replaceAt(Documents::example('minimal.ir.json'), ['api', 'version'], $pathVersion);
        $base = Documents::replaceAt($withPathVersion, ['kinds'], ['httpOperation']);

        foreach ($places as [$path, $deep]) {
            $refusal = $this->nestingRefusal($base, $path, $deep);

            self::assertStringStartsWith('/' . implode('/', $path), $refusal->member);
        }
    }

    public function testExactlyTheBoundIsRead(): void
    {
        // Known members: an array type use chain in a map schema's values, its scalar's refinements one level more.
        // The root object is level 1, so the first array type use is level 4.
        $everyMember = Documents::example('every-member.ir.json');
        $this->readBothWays($everyMember, ['schemas', 'Labels', 'values'], Deep::arrayTypeUses(251));
        $known = $this->nestingRefusal($everyMember, ['schemas', 'Labels', 'values'], Deep::arrayTypeUses(252));
        self::assertSame('/schemas/Labels/values' . str_repeat('/items', 252) . '/refinements', $known->member);
        self::assertSame('257', $known->value);
        self::assertSame(['256'], $known->expected);
        self::assertNull($known->operation);

        $minimal = Documents::example('minimal.ir.json');
        $this->readBothWays($minimal, ['x'], Deep::arrays(255));
        $unknownMember = $this->nestingRefusal($minimal, ['x'], Deep::arrays(256));
        self::assertSame('/x' . str_repeat('/0', 255), $unknownMember->member);

        $unknownKind = Documents::example('unknown-kind.ir.json');
        $this->readBothWays($unknownKind, ['schemas', 'Point', 'items'], Deep::arrays(253));
        $past = $this->nestingRefusal($unknownKind, ['schemas', 'Point', 'items'], Deep::arrays(254));
        self::assertSame('/schemas/Point/items' . str_repeat('/0', 253), $past->member);
    }

    public function testADocumentTooDeepGetsOneRefusal(): void
    {
        $siblings = 10_000;
        $crossing = array_fill(0, $siblings, [0]);
        $value = $crossing;
        for ($level = 0; $level < 254; ++$level) {
            $value = [$value];
        }
        $text = str_repeat('[', 255) . implode(',', array_fill(0, $siblings, '[0]')) . str_repeat(']', 255);

        $refusal = $this->nestingRefusal(Documents::example('minimal.ir.json'), ['x'], new Deep($text, $value));

        self::assertSame('/x' . str_repeat('/0', 255), $refusal->member);
    }

    public function testTheTextScanReadsStringsAndKeysAsTheParserDoes(): void
    {
        // Brackets inside strings are not levels; a key's escapes are decoded, then escaped for the pointer.
        $deep = Deep::arrays(256);
        $text = '{"s":"[[{\"[{\\\\","ké\"/~":' . $deep->text . '}';

        $fromText = $this->refusals($text);
        $document = new \stdClass();
        $document->s = '[[{"[{\\';
        $document->{'ké"/~'} = $deep->value;
        $fromDocument = $this->refusals($document);

        self::assertSame('/ké"~1~0' . str_repeat('/0', 255), $fromText[0]->member);
        self::assertEquals($fromText, $fromDocument);

        // Only four hex digits make a \u escape: the parser rejects `\u+041`, so the pointer keeps it as written.
        $signed = $this->refusals('{"k\u+041":' . $deep->text . '}');
        self::assertSame('/ku+041' . str_repeat('/0', 255), $signed[0]->member);

        // A surrogate pair is one character; a lone one is the replacement character.
        $pair = $this->refusals('{"😀":' . $deep->text . '}');
        self::assertSame("/\u{1F600}" . str_repeat('/0', 255), $pair[0]->member);
        $lone = $this->refusals('{"\ud83dx":' . $deep->text . '}');
        self::assertSame("/\u{FFFD}x" . str_repeat('/0', 255), $lone[0]->member);
    }

    public function testAPointerThatIsNotUtf8IsCutAtAByte(): void
    {
        $deep = Deep::arrays(256);
        $key = str_repeat("\xFF", 200);

        $refusals = $this->refusals('{"' . $key . '":' . $deep->text . '}');

        self::assertSame('/' . $key . str_repeat('/0', 255), $refusals[0]->member);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($refusals[0]->message));
    }

    public function testAContainerIsShownByItsTypeOnly(): void
    {
        $long = str_repeat('x', 100_000);
        $container = (object) ['a' => [$long]];
        $minimal = Documents::example('minimal.ir.json');

        $version = $this->refusals(Documents::replaceAt($minimal, ['irVersion'], $container));
        self::assertSame('object', $version[0]->value);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($version[0]->message));

        $kinds = $this->refusals(Documents::replaceAt($minimal, ['kinds'], [[$long], 'httpOperation']));
        self::assertSame('array', $kinds[0]->value);
        self::assertLessThan(REFUSAL_MESSAGE_BOUND, strlen($kinds[0]->message));

        $pathVersion = (object) ['kind' => 'path', 'number' => $container];
        $number = Documents::replaceAt($minimal, ['api', 'version'], $pathVersion);
        try {
            IrReader::readDocument($number, $this->support);
            self::fail('The IR was read.');
        } catch (IrMalformedException $malformed) {
            self::assertStringContainsString('object', $malformed->getMessage());
            self::assertLessThan(EXCEPTION_MESSAGE_BOUND, strlen($malformed->getMessage()));
        }

        $id = Documents::replaceAt($minimal, ['api', 'id'], $container);
        try {
            IrReader::readDocument($id, $this->support);
            self::fail('The IR was read.');
        } catch (IrMalformedException $malformed) {
            self::assertLessThan(EXCEPTION_MESSAGE_BOUND, strlen($malformed->getMessage()));
        }
    }

    public function testMalformedDocumentsAreNamed(): void
    {
        foreach (['{', '', '{"a":1}{', "\xFF"] as $text) {
            try {
                IrReader::read($text, $this->support);
                self::fail($text);
            } catch (IrMalformedException $malformed) {
                self::assertStringStartsWith('The IR is not JSON: ', $malformed->getMessage(), $text);
            }
        }

        $missingApi = clone Documents::example('minimal.ir.json');
        unset($missingApi->api);
        $untaggedScheme = Documents::replaceAt(Documents::example('minimal.ir.json'), ['schemes', 'client'], (object) ['id' => 'client']);
        foreach ([$missingApi, $untaggedScheme] as $document) {
            try {
                IrReader::readDocument($document, $this->support);
                self::fail('The IR was read.');
            } catch (IrMalformedException $malformed) {
                self::assertStringStartsWith('The IR does not match the IR model: ', $malformed->getMessage());
            }
        }
    }
}
