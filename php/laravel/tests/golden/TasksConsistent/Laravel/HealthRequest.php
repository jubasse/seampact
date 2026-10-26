<?php

declare(strict_types=1);

namespace Seampact\Golden\TasksConsistent\Laravel;

use Illuminate\Foundation\Http\FormRequest;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\BoundaryMark;
use Seampact\Golden\TasksConsistent\Laravel\Runtime\InputTree;

/**
 * The request of operation 'health': its access mark and its validation rules.
 */
final class HealthRequest extends FormRequest
{
    public const API = 'tasks';
    public const OPERATION_ID = 'health';

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
        return [];
    }
}
