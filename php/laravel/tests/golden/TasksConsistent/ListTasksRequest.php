<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\HandlerAccess;
use Seampact\Codegen\Runtime\Nullability;
use Seampact\Codegen\Runtime\Presence;
use Seampact\Golden\TasksConsistent\Laravel\TasksContract;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
use Seampact\Laravel\Runtime\BlankStrings;
use Seampact\Laravel\Runtime\BoundaryMark;
use Seampact\Laravel\Runtime\FormSteps;
use Seampact\Laravel\Runtime\FormatRule;
use Seampact\Laravel\Runtime\HandlerTestRequest;
use Seampact\Laravel\Runtime\InputTree;
use Seampact\Laravel\Runtime\NumberRule;
use Seampact\Laravel\Runtime\Position;
use Seampact\Laravel\Runtime\StringRule;
use Seampact\Laravel\Runtime\TypeRule;
use Seampact\Laravel\Runtime\UnknownKeysRule;

/**
 * The request of operation 'listTasks': its access mark and its validation rules.
 */
final class ListTasksRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'listTasks';

    /** Laravel's own rules on each attribute, by the name `failed()` gives, and the contract rule each one checks. */
    public const NATIVE_RULE_NAMES = [];

    public function authorize(): bool
    {
        BoundaryMark::assertMarked($this, self::API, self::OPERATION_ID);

        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function validationData(): array
    {
        return InputTree::of($this, self::API)->validationData();
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return self::contractRules(InputTree::of($this, self::API));
    }

    protected function failedValidation(Validator $validator): never
    {
        throw FormSteps::failed($this, self::API, $validator, self::NATIVE_RULE_NAMES);
    }

    protected function passedValidation(): void
    {
        FormSteps::passed($this, self::API);
    }

    /**
     * The validated input of the operation, typed.
     */
    public function contractInput(): ListTasksInput
    {
        $input = BoundaryState::required($this, self::API)->contractInput;

        return $input instanceof ListTasksInput ? $input : throw new \LogicException('seampact: the input of operation ' . self::OPERATION_ID . ' was not validated.');
    }

    /**
     * The caller.
     */
    public function principal(): UserPrincipal
    {
        return HandlerAccess::authenticatedPrincipal(BoundaryState::required($this, self::API), self::OPERATION_ID, UserPrincipal::class);
    }

    /**
     * The scopes the operation runs in, as their resolvers resolved them.
     */
    public function scopes(): ListTasksScopes
    {
        return HandlerAccess::scopes(BoundaryState::required($this, self::API), self::OPERATION_ID, ListTasksScopes::class);
    }

    /**
     * A request for a unit test that calls the handler directly, never served: the handler reads the input, the caller
     * and the scopes given here.
     */
    public static function forTest(ListTasksInput $input, UserPrincipal $principal, ListTasksScopes $scopes): self
    {
        return HandlerTestRequest::admitted(new self(), TasksContract::class, self::OPERATION_ID, $input, $principal, [$scopes->channel()]);
    }

    /**
     * @return array<string, list<mixed>>
     */
    public static function contractRules(InputTree $input): array
    {
        return [
            'path.channelId' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Required, Nullability::NotNull),
                new FormatRule($input, Position::Member, FormatRule::UUID, BlankStrings::Every),
            ],
            'query.cursor' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Optional, Nullability::NotNull),
            ],
            'query.limit' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::INTEGER, Presence::Optional, Nullability::NotNull),
                new NumberRule($input, Position::Member, minimum: 1, maximum: 50),
            ],
            'query.sort' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::ARRAY, Presence::Optional, Nullability::NotNull),
            ],
            'query.sort.*' => [
                'bail',
                new TypeRule($input, Position::Item, TypeRule::STRING, Presence::Required, Nullability::NotNull),
                new StringRule($input, Position::Item, BlankStrings::Every, pattern: '/^(?:createdAt|-createdAt)$/uD'),
            ],
            'query' => [
                new UnknownKeysRule($input, Position::Member, ['cursor', 'limit', 'sort']),
            ],
        ];
    }
}
