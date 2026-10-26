<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

use Illuminate\Foundation\Http\FormRequest;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryMark;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\FormatRule;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\InputTree;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Nullability;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Position;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\Presence;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\TypeRule;

/**
 * The request of operation 'getChannel': its access mark and its validation rules.
 */
final class GetChannelRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'getChannel';

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

    /**
     * @return array<string, list<mixed>>
     */
    public static function contractRules(InputTree $input): array
    {
        return [
            'path.channelId' => [
                'bail',
                new TypeRule($input, Position::Member, TypeRule::STRING, Presence::Required, Nullability::NotNull),
                new FormatRule($input, Position::Member, FormatRule::UUID),
            ],
        ];
    }
}
