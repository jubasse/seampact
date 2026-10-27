<?php

declare(strict_types=1);

namespace Seampact\Golden\Tasks;

use Illuminate\Contracts\Validation\Validator;
use Illuminate\Foundation\Http\FormRequest;
use Seampact\Golden\Tasks\Laravel\Runtime\BlankStrings;
use Seampact\Golden\Tasks\Laravel\Runtime\BoundaryMark;
use Seampact\Golden\Tasks\Laravel\Runtime\BoundaryState;
use Seampact\Golden\Tasks\Laravel\Runtime\FormSteps;
use Seampact\Golden\Tasks\Laravel\Runtime\FormatRule;
use Seampact\Golden\Tasks\Laravel\Runtime\InputTree;
use Seampact\Golden\Tasks\Laravel\Runtime\Nullability;
use Seampact\Golden\Tasks\Laravel\Runtime\Position;
use Seampact\Golden\Tasks\Laravel\Runtime\Presence;
use Seampact\Golden\Tasks\Laravel\Runtime\TypeRule;
use Seampact\Golden\Tasks\Laravel\Runtime\UnknownKeysRule;

/**
 * The request of operation 'getDraft': its access mark and its validation rules.
 */
final class GetDraftRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'getDraft';

    /** Laravel's own rules on each attribute, by the name `failed()` gives, and the contract rule each one checks. */
    public const NATIVE_RULE_NAMES = ['path.draftId' => ['Uuid' => 'format']];

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
    public function contractInput(): GetDraftInput
    {
        $input = BoundaryState::required($this, self::API)->contractInput;

        return $input instanceof GetDraftInput ? $input : throw new \LogicException('seampact: the input of operation ' . self::OPERATION_ID . ' was not validated.');
    }

    /**
     * @return array<string, list<mixed>>
     */
    public static function contractRules(InputTree $input): array
    {
        return [
            'path.draftId' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Required, Nullability::NotNull),
                'uuid',
                new FormatRule($input, Position::Member, FormatRule::UUID, BlankStrings::BlankOnly),
            ],
            'query' => [
                new UnknownKeysRule($input, Position::Member, []),
            ],
        ];
    }
}
