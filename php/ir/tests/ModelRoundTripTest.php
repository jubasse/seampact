<?php

declare(strict_types=1);

namespace Seampact\Ir\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Ir\Model\ArrayTypeUse;
use Seampact\Ir\Model\BodyUnionTag;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\Enum_;
use Seampact\Ir\Model\ErrorHttp;
use Seampact\Ir\Model\IrModelException;
use Seampact\Ir\Model\Maturity;
use Seampact\Ir\Model\OperationError;
use Seampact\Ir\Model\SchemaUnknown;
use Seampact\Ir\Model\SourceMap;
use Seampact\Ir\Model\TypeUse;
use Seampact\Ir\Tests\Support\Documents;

// The generated model reads the IR examples and writes back the same document, up to member order and the
// unknown members it drops. The reader with its version and support checks comes on top of this model.
final class ModelRoundTripTest extends TestCase
{
    private function roundTrip(\stdClass $document): \stdClass
    {
        return ContractIR::fromJson($document)->toJson();
    }

    public function testExamplesWithoutUnknownMembersRoundTrip(): void
    {
        foreach (['minimal.ir.json', 'every-member.ir.json', 'unknown-enum-value.ir.json', 'unknown-kind.ir.json'] as $name) {
            $document = Documents::example($name);

            self::assertSame(Documents::canonical($document), Documents::canonical($this->roundTrip($document)), $name);
        }
    }

    public function testUnknownMembersAreDropped(): void
    {
        $document = Documents::example('unknown-member.ir.json');
        $expected = Documents::withoutMember($document, [], 'generatedBy');
        $expected = Documents::withoutMember($expected, ['api'], 'owner');
        $expected = Documents::withoutMember($expected, ['api', 'origin'], 'column');

        self::assertSame(Documents::canonical($expected), Documents::canonical($this->roundTrip($document)));
    }

    public function testUnknownEnumValueIsKept(): void
    {
        $contract = ContractIR::fromJson(Documents::example('unknown-enum-value.ir.json'));

        self::assertFalse($contract->api->maturity->isKnown());
        self::assertSame('stable', Maturity::of('stable')->value);
        self::assertTrue(Maturity::of(Maturity::Stable)->isKnown());
    }

    public function testEmptyObjectsRoundTrip(): void
    {
        $written = json_encode($this->roundTrip(Documents::example('minimal.ir.json')), JSON_THROW_ON_ERROR);

        self::assertStringContainsString('"extensions":{}', $written);
        self::assertStringContainsString('"docs":{}', $written);
        self::assertStringContainsString('"schemas":{}', $written);
    }

    public function testOptionalOpaqueKeepsAnExplicitNull(): void
    {
        $withNull = '{"code":"conflict","example":null}';
        $absent = '{"code":"conflict"}';

        $decodedNull = OperationError::fromJson(json_decode($withNull, false, 512, JSON_THROW_ON_ERROR));
        $decodedAbsent = OperationError::fromJson(json_decode($absent, false, 512, JSON_THROW_ON_ERROR));

        self::assertNotNull($decodedNull->example);
        self::assertNull($decodedNull->example->value);
        self::assertNull($decodedAbsent->example);
        self::assertSame($withNull, json_encode($decodedNull->toJson(), JSON_THROW_ON_ERROR));
        self::assertSame($absent, json_encode($decodedAbsent->toJson(), JSON_THROW_ON_ERROR));
    }

    public function testReservedTypeNameIsEscaped(): void
    {
        self::assertTrue(class_exists(Enum_::class));
    }

    public function testUnknownUnionTagIsKeptRaw(): void
    {
        $document = Documents::example('unknown-kind.ir.json');
        $point = ContractIR::fromJson($document)->schemas['Point'];

        self::assertInstanceOf(SchemaUnknown::class, $point);
        self::assertSame('tuple', $point->tag());
        self::assertSame(Documents::canonical(Documents::at($document, 'schemas', 'Point')), Documents::canonical($point->raw));
    }

    public function testMissingTagNamesTheUnion(): void
    {
        $this->expectException(IrModelException::class);
        $this->expectExceptionMessage("TypeUse: the tag member 'kind'");

        TypeUse::fromJson((object) ['schema' => 'Task']);
    }

    public function testSourceMapRoundTrips(): void
    {
        $document = Documents::example('minimal.source-map.json');

        self::assertSame(Documents::canonical($document), Documents::canonical(SourceMap::fromJson($document)->toJson()));
    }

    public function testVariantTagIsFixed(): void
    {
        $this->expectException(IrModelException::class);

        BodyUnionTag::fromJson((object) ['in' => 'header', 'property' => 'kind']);
    }

    public function testAVariantBuiltByHandCarriesItsTag(): void
    {
        self::assertSame('body', (new BodyUnionTag(property: 'kind'))->in);
        self::assertSame('array', (new ArrayTypeUse(items: TypeUse::fromJson((object) ['kind' => 'schema'])))->tag());
    }

    public function testUnknownCasesStayUnknown(): void
    {
        $this->expectException(IrModelException::class);

        new SchemaUnknown('object', (object) ['kind' => 'object']);
    }

    public function testAnUnknownCaseNeedsItsOwnTagInRaw(): void
    {
        $this->expectException(IrModelException::class);

        new SchemaUnknown('pair', (object) ['kind' => 'tuple']);
    }

    public function testIntegralNumberReadsAsInteger(): void
    {
        self::assertSame(404, ErrorHttp::fromJson(json_decode('{"status": 404.0}', false))->status);
    }

    public function testNonIntegersAreRefused(): void
    {
        foreach (['{"status": 404.5}', '{"status": "404"}', '{"status": 1e30}', '{"status": null}'] as $text) {
            try {
                ErrorHttp::fromJson(json_decode($text, false));
                self::fail($text);
            } catch (IrModelException $error) {
                self::assertStringStartsWith('ErrorHttp.status: expected an integer', $error->getMessage(), $text);
            }
        }
    }

    public function testAMemberOfTheWrongTypeNamesTheMember(): void
    {
        $this->expectExceptionMessage('ErrorHttp.status: expected an integer, got the JSON type object');

        ErrorHttp::fromJson((object) ['status' => (object) []]);
    }

    public function testAnObjectWhereAListIsExpectedIsRefused(): void
    {
        $document = Documents::replaceAt(Documents::example('minimal.ir.json'), ['features'], (object) []);

        $this->expectExceptionMessage('ContractIR.features: expected a JSON array, got the JSON type object');

        ContractIR::fromJson($document);
    }

    public function testCatalogueKeysStayStrings(): void
    {
        $document = Documents::example('minimal.ir.json');
        $scheme = Documents::replaceAt(
            Documents::objectAt(Documents::example('unknown-must-act.ir.json'), 'schemes', 'client'),
            ['kind'],
            'bearer',
        );
        $schemes = new \stdClass();
        $schemes->{'1042'} = $scheme;
        $schemes->{'__proto__'} = $scheme;
        $document = Documents::replaceAt($document, ['schemes'], $schemes);

        $schemesRead = ContractIR::fromJson($document)->schemes;
        $written = json_encode(ContractIR::fromJson($document)->toJson(), JSON_THROW_ON_ERROR);

        self::assertSame(['1042', '__proto__'], array_map(strval(...), array_keys($schemesRead)));
        self::assertStringContainsString('"schemes":{"1042":', $written);
        self::assertStringContainsString('"__proto__":{', $written);
    }

    public function testMutatingTheInputAfterReadingLeavesTheModelUnchanged(): void
    {
        $document = Documents::example('unknown-kind.ir.json');
        $expected = Documents::canonical(ContractIR::fromJson($document)->toJson());
        $ir = ContractIR::fromJson($document);

        $input = Documents::objectAt($document, 'schemas', 'Point');
        $input->added = true;
        $input->shape = 'changed';

        self::assertSame($expected, Documents::canonical($ir->toJson()));
        $point = $ir->schemas['Point'];
        self::assertInstanceOf(SchemaUnknown::class, $point);
        self::assertObjectNotHasProperty('added', $point->raw);
    }

    public function testMutatingAToJsonResultLeavesTheModelUnchanged(): void
    {
        $ir = ContractIR::fromJson(Documents::example('unknown-kind.ir.json'));
        $expected = Documents::canonical($ir->toJson());

        Documents::objectAt($ir->toJson(), 'schemas', 'Point')->added = true;
        $point = $ir->schemas['Point'];
        self::assertInstanceOf(SchemaUnknown::class, $point);
        $point->toJson()->added = true;

        self::assertSame($expected, Documents::canonical($ir->toJson()));
    }

    public function testOpaqueAndExtensionValuesAreCopied(): void
    {
        $document = Documents::example('every-member.ir.json');
        $expected = Documents::canonical(ContractIR::fromJson($document)->toJson());
        $ir = ContractIR::fromJson($document);

        $out = $ir->toJson();
        $this->mutateEveryObject($out);
        $this->mutateEveryObject($document);

        self::assertSame($expected, Documents::canonical($ir->toJson()));
    }

    private function mutateEveryObject(mixed $value): void
    {
        if (is_array($value)) {
            array_map($this->mutateEveryObject(...), $value);

            return;
        }
        if (!$value instanceof \stdClass) {
            return;
        }
        foreach (get_object_vars($value) as $member) {
            $this->mutateEveryObject($member);
        }
        $value->mutated = true;
    }
}
