<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Http\Request;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\HookLookup;
use Seampact\Codegen\Tests\Support\UpdateNoteInput;
use Seampact\Codegen\Tests\Support\VersionedNotesContract;
use Seampact\Hooks\RequestView;
use Seampact\Laravel\Runtime\FormSteps;
use Seampact\Laravel\Runtime\InputTree;

/**
 * The FormRequest steps read an `If-Match` version before the validator's issues: a missing header answers 428, not a
 * schema issue, and a weak tag reaches the handler unquoted.
 */
final class VersionHeaderStepTest extends TestCase
{
    public function testAMissingIfMatchAnswers428NotASchemaIssue(): void
    {
        try {
            $refusal = FormSteps::failed($this->request(null), VersionedNotesContract::API, $this->createStub(Validator::class), []);
        } catch (ContractRefusal $thrown) {
            $refusal = $thrown;
        }

        self::assertSame('api.precondition_required', $refusal->contractCode);
    }

    public function testAWeakTagReachesTheHandlerUnquoted(): void
    {
        $input = FormSteps::passed($this->request('W/"7"'), VersionedNotesContract::API);

        self::assertInstanceOf(UpdateNoteInput::class, $input);
        self::assertSame('7', $input->headers->ifMatch);
    }

    private function request(?string $ifMatch): Request
    {
        $request = Request::create('/api/v1/notes/n', 'PATCH');
        $headers = [];
        if ($ifMatch !== null) {
            $request->headers->set('If-Match', $ifMatch);
            $headers['If-Match'] = $ifMatch;
        }

        $contract = ApiContract::of(VersionedNotesContract::class);
        $state = new BoundaryState($contract, 'updateNote', ['noteId' => 'n'], new RequestView('PATCH', '/api/v1/notes/n', []), $this->createStub(HookLookup::class));
        $request->attributes->set(BoundaryState::attributeName($contract->api), $state);
        $request->attributes->set(InputTree::attributeName($contract->api), InputTree::withoutBody(['noteId' => 'n'], [], $headers));

        return $request;
    }
}
