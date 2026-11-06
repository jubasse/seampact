<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Runtime\VersionHeader;
use Seampact\Codegen\Tests\Support\VersionedNotesContract;
use Seampact\Hooks\RequestView;
use Symfony\Component\HttpFoundation\Request;

/**
 * An `If-Match` write reads its version before the input is validated: a missing, empty or `*` header answers 428, a
 * list or a value that is no tag 412, and a strong or weak tag hands the handler the version unquoted.
 */
final class VersionHeaderTest extends TestCase
{
    /** @return iterable<string, array{list<string>, string}> */
    public static function refusedHeaders(): iterable
    {
        yield 'missing' => [[], 'api.precondition_required'];
        yield 'empty' => [[''], 'api.precondition_required'];
        yield 'any' => [['*'], 'api.precondition_required'];
        yield 'list' => [['"1", "2"'], 'api.precondition_failed'];
        yield 'two lines' => [['"1"', '"2"'], 'api.precondition_failed'];
        yield 'unquoted' => [['1'], 'api.precondition_failed'];
    }

    /** @param list<string> $values */
    #[DataProvider('refusedHeaders')]
    public function testAVersionHeaderThatNamesNoOneVersionIsRefusedWithItsRole(array $values, string $code): void
    {
        try {
            VersionHeader::sent($this->request($values), $this->state());
            self::fail('The version header was not refused.');
        } catch (ContractRefusal $refusal) {
            self::assertSame($code, $refusal->contractCode);
        }
    }

    public function testAStrongOrWeakTagHandsTheHandlerTheVersionUnquoted(): void
    {
        $state = $this->state();
        $strong = VersionHeader::sent($this->request(['"7"']), $state);
        $weak = VersionHeader::sent($this->request(['W/"7"']), $state);

        self::assertSame('7', $strong);
        self::assertSame('7', $weak);
        self::assertEquals((object) ['If-Match' => '7'], VersionHeader::handedOver($state, $weak, (object) ['If-Match' => 'W/"7"']));
    }

    public function testAnOperationWithoutAHeaderVersionReadsNothing(): void
    {
        $contract = ApiContract::of(VersionedNotesContract::class);
        $state = new BoundaryState($contract, 'legacyNote', [], new RequestView('GET', '/api/v1/notes/n/legacy', []), $this->createStub(HookLookup::class));

        self::assertNull(VersionHeader::sent($this->request([]), $state));
    }

    /** @param list<string> $values */
    private function request(array $values): Request
    {
        $request = Request::create('/api/v1/notes/n', 'PATCH');
        if ($values !== []) {
            $request->headers->set('If-Match', $values);
        }

        return $request;
    }

    private function state(): BoundaryState
    {
        $contract = ApiContract::of(VersionedNotesContract::class);

        return new BoundaryState($contract, 'updateNote', ['noteId' => 'n'], new RequestView('PATCH', '/api/v1/notes/n', []), $this->createStub(HookLookup::class));
    }
}
