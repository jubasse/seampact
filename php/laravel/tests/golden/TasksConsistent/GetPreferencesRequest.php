<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Seampact\Codegen\Runtime\BoundaryState;
use Seampact\Codegen\Runtime\HandlerAccess;
use Seampact\Codegen\Runtime\Nullability;
use Seampact\Codegen\Runtime\Presence;
use Seampact\Golden\TasksConsistent\Laravel\UserPrincipal;
use Seampact\Laravel\Runtime\BoundaryMark;
use Seampact\Laravel\Runtime\FormSteps;
use Seampact\Laravel\Runtime\InputTree;
use Seampact\Laravel\Runtime\Position;
use Seampact\Laravel\Runtime\TypeRule;
use Seampact\Laravel\Runtime\UnknownKeysRule;

/**
 * The request of operation 'getPreferences': its access mark and its validation rules.
 */
final class GetPreferencesRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'getPreferences';

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
    public function contractInput(): GetPreferencesInput
    {
        $input = BoundaryState::required($this, self::API)->contractInput;

        return $input instanceof GetPreferencesInput ? $input : throw new \LogicException('seampact: the input of operation ' . self::OPERATION_ID . ' was not validated.');
    }

    /**
     * The caller.
     */
    public function principal(): UserPrincipal
    {
        return HandlerAccess::authenticatedPrincipal(BoundaryState::required($this, self::API), UserPrincipal::class);
    }

    /**
     * @return array<string, list<mixed>>
     */
    public static function contractRules(InputTree $input): array
    {
        return [
            'headers.If-None-Match' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Optional, Nullability::NotNull),
            ],
            'query' => [
                new UnknownKeysRule($input, Position::Member, []),
            ],
        ];
    }
}
