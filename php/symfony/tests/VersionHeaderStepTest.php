<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Psr\Log\NullLogger;
use Seampact\Codegen\Runtime\ApiContract;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\ContractRefusal;
use Seampact\Codegen\Runtime\DecodedInput;
use Seampact\Codegen\Runtime\RawTarget;
use Seampact\Codegen\Tests\Support\UpdateNoteInput;
use Seampact\Codegen\Tests\Support\VersionedNotesContract;
use Seampact\Golden\Tasks\Symfony\SeampactOperation;
use Seampact\Golden\Tasks\Symfony\TasksSettings;
use Seampact\Golden\Tasks\TasksContractException;
use Seampact\Symfony\Runtime\BoundarySubscriber;
use Seampact\Symfony\Runtime\Hooks;
use Symfony\Component\DependencyInjection\ServiceLocator;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpKernel\Event\ControllerEvent;
use Symfony\Component\HttpKernel\HttpKernelInterface;
use Symfony\Component\Validator\Constraint;
use Symfony\Component\Validator\Constraints\Type;
use Symfony\Component\Validator\Validation;

/**
 * The boundary's input step reads an `If-Match` version before the validator: a missing header answers 428, not a
 * schema issue, and a weak tag reaches the handler unquoted.
 */
final class VersionHeaderStepTest extends TestCase
{
    private const INPUT_ATTRIBUTE = '_seampact_notes_input';

    public function testAMissingIfMatchAnswers428NotASchemaIssue(): void
    {
        try {
            $this->controlled(null);
            self::fail('The write without If-Match was not refused.');
        } catch (ContractRefusal $refusal) {
            self::assertSame('api.precondition_required', $refusal->contractCode);
        }
    }

    public function testAWeakTagReachesTheHandlerUnquoted(): void
    {
        $input = $this->controlled('W/"7"')->attributes->get(self::INPUT_ATTRIBUTE);

        self::assertInstanceOf(UpdateNoteInput::class, $input);
        self::assertSame('7', $input->headers->ifMatch);
    }

    // Steps 2 to 8 of `updateNote` on a request step 1 decoded, as the kernel's controller event runs them.
    private function controlled(?string $ifMatch): Request
    {
        $contract = ApiContract::of(VersionedNotesContract::class);
        $request = Request::create('/api/v1/notes/n', 'PATCH');
        $headers = [];
        if ($ifMatch !== null) {
            $request->headers->set('If-Match', $ifMatch);
            $headers['If-Match'] = $ifMatch;
        }

        $hooks = new Hooks(new ServiceLocator([]), [], [], null, new NullLogger());
        $request->attributes->set(BoundaryState::attributeName($contract->api), new BoundaryState($contract, 'updateNote', ['noteId' => 'n'], RawTarget::view($request), $hooks));
        $request->attributes->set("_seampact_{$contract->api}_decoded", new DecodedInput(['noteId' => 'n'], [], $headers));
        $request->attributes->set('_route', $contract->routeName('updateNote'));
        $request->attributes->set('_seampact_operation', 'updateNote');

        $boundary = new class ($hooks, new TasksSettings(null, null, [], 'https://api.example.com'), Validation::createValidator()) extends BoundarySubscriber {
            protected function contractClass(): string
            {
                return VersionedNotesContract::class;
            }

            protected function inputConstraint(string $operationId): Constraint
            {
                return new Type('object');
            }

            protected function inputAttribute(): string
            {
                return '_seampact_notes_input';
            }

            protected function operationAttribute(): string
            {
                return SeampactOperation::class;
            }

            protected function contractExceptionClass(): string
            {
                return TasksContractException::class;
            }

            protected function checksHooks(): bool
            {
                return false;
            }
        };
        $handler = new class () {
            #[SeampactOperation('updateNote')]
            public function updateNote(): void
            {
            }
        };

        $boundary->onController(new ControllerEvent($this->createStub(HttpKernelInterface::class), [$handler, 'updateNote'], $request, HttpKernelInterface::MAIN_REQUEST));

        return $request;
    }
}
