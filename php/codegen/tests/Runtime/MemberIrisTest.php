<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests\Runtime;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\PageReply;
use Seampact\Codegen\Runtime\ResourceIris;
use Seampact\Hooks\RequestView;

/** The member URL a page item or an item body carries, built from the resource's member route. */
final class MemberIrisTest extends TestCase
{
    public function testEachPageItemCarriesItsMemberUrlWithTheParentParamsOfTheRequest(): void
    {
        $state = self::stateOf('listTasks', ['channelId' => 'general']);

        [$body] = PageReply::render($state, '', '/api/v1/channels/general/tasks', [(object) ['taskId' => 't1', 'id' => 'a'], (object) ['taskId' => 't2', 'id' => 'b']], ['total' => 2], 200);

        self::assertSame(['/api/v1/channels/general/tasks/t1', '/api/v1/channels/general/tasks/t2'], self::memberIds($body));
    }

    public function testAnIdAndAParentParamThatNeedEncodingAreWrittenWithOneEncoder(): void
    {
        $state = self::stateOf('listTasks', ['channelId' => 'a%20b']);

        [$body] = PageReply::render($state, '', '/api/v1/channels/a%20b/tasks', [(object) ['taskId' => 'x y/é', 'id' => 'a']], ['total' => 1], 200);

        self::assertSame(['/api/v1/channels/a%20b/tasks/x%20y%2F%C3%A9'], self::memberIds($body));
    }

    public function testAnItemWithoutAnIdHasNoMemberUrl(): void
    {
        $state = self::stateOf('listTasks', ['channelId' => 'general']);

        [$body] = PageReply::render($state, '', '/api/v1/channels/general/tasks', [(object) ['id' => 'a']], ['total' => 1], 200);

        self::assertSame([null], self::memberIds($body));
    }

    public function testTheMemberRouteIsFoundBesideTheOperationOfTheSameResource(): void
    {
        self::assertSame(['path' => '/v1/channels/{channelId}/tasks/{taskId}', 'idParam' => 'taskId'], ResourceIris::memberRoute(self::stateOf('listTasks', [])));
        self::assertNull(ResourceIris::memberRoute(self::stateOf('listNotes', [])));
    }

    /** @return list<?string> the `@id` of each member of a rendered page, null for a member without one */
    private static function memberIds(mixed $body): array
    {
        self::assertInstanceOf(\stdClass::class, $body);
        self::assertIsArray($body->member);

        $ids = [];
        foreach ($body->member as $member) {
            self::assertInstanceOf(\stdClass::class, $member);
            $id = $member->{'@id'} ?? null;
            self::assertTrue($id === null || is_string($id));
            $ids[] = $id;
        }

        return $ids;
    }

    /** @param array<string, string> $rawParameters */
    private static function stateOf(string $operationId, array $rawParameters): BoundaryState
    {
        return new BoundaryState(ApiContract::of(MemberIrisContract::class), $operationId, $rawParameters, new RequestView('GET', '/x', []), PageReplyTest::lookup());
    }
}
