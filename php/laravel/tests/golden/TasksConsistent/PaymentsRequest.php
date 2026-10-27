<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryMark;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryState;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\FormSteps;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\InputTree;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Nullability;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Position;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Presence;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\TypeRule;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\UnknownKeysRule;

/**
 * The request of operation 'payments': its access mark and its validation rules.
 */
final class PaymentsRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'payments';

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
    public function contractInput(): PaymentsInput
    {
        $input = BoundaryState::required($this, self::API)->contractInput;

        return $input instanceof PaymentsInput ? $input : throw new \LogicException('seampact: the input of operation ' . self::OPERATION_ID . ' was not validated.');
    }

    /**
     * @return array<string, list<mixed>>
     */
    public static function contractRules(InputTree $input): array
    {
        return [
            'query' => [
                new UnknownKeysRule($input, Position::Member, []),
            ],
            'body' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::OBJECT, Presence::Required, Nullability::NotNull),
                new UnknownKeysRule($input, Position::Member, ['id', 'type', 'data']),
            ],
            'body.id' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Required, Nullability::NotNull),
            ],
            'body.type' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Required, Nullability::NotNull),
            ],
            'body.data' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::ANY, Presence::Required, Nullability::NotNull),
            ],
        ];
    }
}
