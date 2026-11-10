<?php

declare(strict_types=1);

namespace Seampact\Laravel\Runtime;

use Seampact\Codegen\Runtime\InputRuleSet;

/**
 * The app's input rules of one operation and one input part, in Laravel's validation syntax (ADR 0028): the keys of
 * `rules()` are wire names relative to the part (`end`, `items.*.name`; a wire name holding `.` or `*` is written with
 * `InputTree::escape`), and the empty key `''` is the part itself, for a rule across members (a `ValidationRule` that
 * is also a `DataAwareRule` and has `public bool $implicit = true`). A rule's name is its class short name, first
 * letter lowered, or Laravel's own rule name.
 */
interface InputRules extends InputRuleSet
{
    /** @return array<string, mixed> the rules by attribute, as `Validator::make` takes them */
    public function rules(): array;
}
