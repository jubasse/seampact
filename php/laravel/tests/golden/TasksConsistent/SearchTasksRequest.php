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
use Seampact\Laravel\Runtime\EnumRule;
use Seampact\Laravel\Runtime\FormSteps;
use Seampact\Laravel\Runtime\FormatRule;
use Seampact\Laravel\Runtime\HandlerTestRequest;
use Seampact\Laravel\Runtime\InputTree;
use Seampact\Laravel\Runtime\ItemCountRule;
use Seampact\Laravel\Runtime\Position;
use Seampact\Laravel\Runtime\StringRule;
use Seampact\Laravel\Runtime\TypeRule;
use Seampact\Laravel\Runtime\UnknownKeysRule;

/**
 * The request of operation 'searchTasks': its access mark and its validation rules.
 */
final class SearchTasksRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'searchTasks';

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
    public function contractInput(): SearchTasksInput
    {
        $input = BoundaryState::required($this, self::API)->contractInput;

        return $input instanceof SearchTasksInput ? $input : throw new \LogicException('seampact: the input of operation ' . self::OPERATION_ID . ' was not validated.');
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
    public function scopes(): SearchTasksScopes
    {
        return HandlerAccess::scopes(BoundaryState::required($this, self::API), self::OPERATION_ID, SearchTasksScopes::class);
    }

    /**
     * A request for a unit test that calls the handler directly, never served: the handler reads the input, the caller
     * and the scopes given here.
     */
    public static function forTest(SearchTasksInput $input, UserPrincipal $principal, SearchTasksScopes $scopes): self
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
            'query' => [
                new UnknownKeysRule($input, Position::Member, []),
            ],
            'body' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::OBJECT, Presence::Required, Nullability::NotNull),
                new UnknownKeysRule($input, Position::Member, ['text', 'states']),
            ],
            'body.text' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Optional, Nullability::NotNull),
                new StringRule($input, Position::Member, BlankStrings::Every, maxLength: 200),
            ],
            'body.states' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::ARRAY, Presence::Optional, Nullability::NotNull),
                new ItemCountRule($input, Position::Member, maxItems: 3),
            ],
            'body.states.*' => [
                'bail',
                new TypeRule($input, Position::Item, TypeRule::STRING, Presence::Required, Nullability::NotNull),
                new EnumRule($input, Position::Item, ['open', 'done', 'archived']),
            ],
        ];
    }
}
