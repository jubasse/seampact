<?php

declare(strict_types=1);

namespace Seampact\Laravel\Tests;

use Illuminate\Translation\ArrayLoader;
use Illuminate\Translation\Translator;
use Illuminate\Validation\Factory;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Laravel\LaravelGenerator;
use Seampact\Laravel\Runtime\ContractIssue;
use Seampact\Laravel\Runtime\InputTree;

/**
 * The rules a generated FormRequest returns, run in Laravel's validator over a decoded body: the getTasksBatch body
 * of the reference contract, with members added for the forms the reference body lacks (a member both optional and
 * nullable, a bounded integer, a number, a string with a length and a pattern, an integer with a step).
 */
final class FormRequestRulesTest extends TestCase
{
    private const NATIVE_NAMESPACE = 'Seampact\\Behaviour\\Native';
    private const CONSISTENT_NAMESPACE = 'Seampact\\Behaviour\\Consistent';
    private const CHANNEL_ID = '0b6e5d1c-8f0a-4c4e-9a7e-1f2d3c4b5a69';
    private const TASK_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

    private static string $generatedDirectory;

    public static function setUpBeforeClass(): void
    {
        self::$generatedDirectory = sys_get_temp_dir() . '/seampact-laravel-rules-' . bin2hex(random_bytes(6));
        $generator = new LaravelGenerator();
        $ir = ReferenceContract::read(new LaravelGenerator(), self::withAddedMembers(ReferenceContract::kept(ReferenceContract::document(ReferenceContract::TASKS), ['getTasksBatch'])));

        foreach ([self::NATIVE_NAMESPACE => [], self::CONSISTENT_NAMESPACE => ['rules' => 'seampact-consistent']] as $namespace => $options) {
            $root = self::$generatedDirectory . '/' . str_replace('\\', '/', $namespace);
            foreach ($generator->generate($ir, ReferenceContract::entry(LaravelGenerator::PACKAGE, 'tasks', $namespace, $options)) as $file) {
                $target = "{$root}/{$file->path}";
                if (!is_dir(dirname($target))) {
                    mkdir(dirname($target), 0o700, true);
                }
                file_put_contents($target, $file->contents);
            }
        }

        spl_autoload_register(static function (string $className): void {
            $path = self::$generatedDirectory . '/' . str_replace('\\', '/', $className) . '.php';
            if (str_starts_with($className, 'Seampact\\Behaviour\\') && is_file($path)) {
                require $path;
            }
        });
    }

    public static function tearDownAfterClass(): void
    {
        $paths = new \RecursiveIteratorIterator(new \RecursiveDirectoryIterator(self::$generatedDirectory, \FilesystemIterator::SKIP_DOTS), \RecursiveIteratorIterator::CHILD_FIRST);
        foreach ($paths as $path) {
            if ($path instanceof \SplFileInfo) {
                $path->isDir() ? rmdir($path->getPathname()) : unlink($path->getPathname());
            }
        }
        rmdir(self::$generatedDirectory);
    }

    public function testAMemberBothOptionalAndNullableIsAFieldAndKeepsNullApartFromAbsent(): void
    {
        $schema = (string) file_get_contents(self::$generatedDirectory . '/Seampact/Behaviour/Native/Schemas/GetTasksBatchInput.php');
        self::assertStringContainsString('public Field $note,', $schema);
        self::assertStringContainsString('@param Field<string> $note', $schema);

        self::assertSame([], $this->issues(['ids' => [], 'note' => null]));
        self::assertSame([], $this->issues(['ids' => []]));
        self::assertSame([['body', '/count', 'type']], $this->issues(['ids' => [], 'count' => null]));
        self::assertSame([['body', '/ids', 'required']], $this->issues(['note' => 'x']));
    }

    public function testANumberIsComparedByValueBehindNumericStrict(): void
    {
        self::assertSame([], $this->issues(['ids' => [], 'count' => 1.0, 'ratio' => 0.25]));
        self::assertSame([['body', '/count', 'type']], $this->issues(['ids' => [], 'count' => '5']));
        self::assertSame([['body', '/count', 'maximum']], $this->issues(['ids' => [], 'count' => 11]));
        self::assertSame([['body', '/count', 'minimum']], $this->issues(['ids' => [], 'count' => 0]));
        self::assertSame([['body', '/count', 'type']], $this->issues(['ids' => [], 'count' => 2.5]));
    }

    public function testAnIntegerBeyondTheExactFloatRangeIsRefusedAsABound(): void
    {
        self::assertSame([['body', '/count', 'maximum']], $this->issuesOfJson('{"ids":[],"count":9223372036854775808}'));
        self::assertSame([['body', '/count', 'minimum']], $this->issuesOfJson('{"ids":[],"count":-9223372036854775809}'));
        self::assertSame([['body', '/count', 'maximum']], $this->issuesOfJson('{"ids":[],"count":9007199254740994.0}'));
        self::assertSame([], $this->issuesOfJson('{"ids":[],"ratio":9223372036854775808}'));
        self::assertSame([['body', '/label', 'type']], $this->issuesOfJson('{"ids":[],"label":9223372036854775808}'));
    }

    public function testAnIntegerAboveTheSafeRangeIsRefusedAsItsBound(): void
    {
        self::assertSame([['body', '/step', 'maximum']], $this->issuesOfJson('{"ids":[],"step":9007199254740993}'));
        self::assertSame([['body', '/step', 'minimum']], $this->issuesOfJson('{"ids":[],"step":-9007199254740993}'));
    }

    public function testUnknownKeysAndAnObjectInPlaceOfAListAreRefused(): void
    {
        self::assertSame([['body', '/extra', 'unknownKeys']], $this->issues(['ids' => [], 'extra' => 1]));
        self::assertSame([['body', '/ids', 'type']], $this->issuesOfJson('{"ids":{}}'));
        self::assertSame([['body', '', 'type']], $this->issuesOfJson('[]'));
        self::assertSame([['body', '/ids/1', 'format']], $this->issues(['ids' => [self::TASK_ID, 'not-a-uuid']], self::CONSISTENT_NAMESPACE));
    }

    public function testABlankStringStillMeetsTheContractsLengthAndPattern(): void
    {
        self::assertSame([], $this->issues(['ids' => [], 'label' => 'tag-12345']));
        self::assertSame([['body', '/label', 'minLength']], $this->issues(['ids' => [], 'label' => '   ']));
        self::assertSame([['body', '/label', 'minLength']], $this->issues(['ids' => [], 'label' => '']));
        self::assertSame([['body', '/label', 'minLength']], $this->issues(['ids' => [], 'label' => '   '], self::CONSISTENT_NAMESPACE));
        self::assertSame([['body', '/label', 'pattern']], $this->issues(['ids' => [], 'label' => 'label-without-prefix'], self::CONSISTENT_NAMESPACE));
    }

    public function testABlankUuidIsAFormatIssueUnderEitherRuleMode(): void
    {
        self::assertSame([['body', '/ids/0', 'format']], $this->issues(['ids' => ['']]));
        self::assertSame([['body', '/ids/0', 'format']], $this->issues(['ids' => ['   ']]));
        self::assertSame([['path', '/channelId', 'format']], $this->issuesOfJson('{"ids":[]}', path: ['channelId' => '   ']));
        self::assertSame([['body', '/ids/0', 'format']], $this->issues(['ids' => ['']], self::CONSISTENT_NAMESPACE));
    }

    public function testAnUndeclaredQueryKeyIsRefused(): void
    {
        self::assertSame([['query', '/foo', 'unknownKeys']], $this->issuesOfJson('{"ids":[]}', query: ['foo' => '1']));
        self::assertSame([['query', '/foo', 'unknownKeys']], $this->issuesOfJson('{"ids":[]}', self::CONSISTENT_NAMESPACE, query: ['foo' => '1']));
    }

    public function testANonFiniteNumberIsATypeIssue(): void
    {
        self::assertSame([['body', '/ratio', 'type']], $this->issuesOfJson('{"ids":[],"ratio":1e400}'));
        self::assertSame([['body', '/ratio', 'type']], $this->issuesOfJson('{"ids":[],"ratio":-1e400}', self::CONSISTENT_NAMESPACE));
    }

    public function testAnOpaqueValueTakesAnyJsonButANonFiniteNumber(): void
    {
        self::assertSame([], $this->issuesOfJson('{"ids":[],"payload":[1,"two",null,{"nested":true}]}'));
        self::assertSame([['body', '/payload', 'type']], $this->issuesOfJson('{"ids":[],"payload":{"deep":[1e400]}}'));
    }

    public function testAnOpaqueValueTakesNullOnlyWhenNullable(): void
    {
        self::assertSame([['body', '/payload', 'type']], $this->issuesOfJson('{"ids":[],"payload":null}'));
        self::assertSame([['body', '/payload', 'type']], $this->issuesOfJson('{"ids":[],"payload":null}', self::CONSISTENT_NAMESPACE));
        self::assertSame([], $this->issuesOfJson('{"ids":[],"nullablePayload":null}'));
    }

    public function testAMultipleOfIsCheckedExactly(): void
    {
        self::assertSame([], $this->issuesOfJson('{"ids":[],"step":9}', self::CONSISTENT_NAMESPACE));
        self::assertSame([], $this->issuesOfJson('{"ids":[],"step":3000000000000000.0}', self::CONSISTENT_NAMESPACE));
        self::assertSame([['body', '/step', 'multipleOf']], $this->issuesOfJson('{"ids":[],"step":10}', self::CONSISTENT_NAMESPACE));
        self::assertSame([['body', '/step', 'multipleOf']], $this->issuesOfJson('{"ids":[],"step":3000000000000001.0}', self::CONSISTENT_NAMESPACE));
    }

    public function testADecimalStepOnAnIntegerIsItsExactIntegerStep(): void
    {
        foreach ([self::NATIVE_NAMESPACE, self::CONSISTENT_NAMESPACE] as $namespace) {
            self::assertSame([], $this->issuesOfJson('{"ids":[],"halfStep":10}', $namespace));
            self::assertSame([['body', '/halfStep', 'multipleOf']], $this->issuesOfJson('{"ids":[],"halfStep":6}', $namespace));
        }
    }

    public function testNativeRuleFailuresAreNamedWithTheirContractRules(): void
    {
        $failed = $this->failed(['ids' => [], 'count' => 11, 'label' => 'label-without-prefix']);
        $requestClass = self::NATIVE_NAMESPACE . '\\GetTasksBatchRequest';
        $names = constant("{$requestClass}::NATIVE_RULE_NAMES");
        self::assertIsArray($names);

        self::assertSame(['body.count' => ['Lte'], 'body.label' => ['Regex']], $failed);
        self::assertSame(['Numeric' => 'type', 'Gte' => 'minimum', 'Lte' => 'maximum'], $names['body.count'] ?? null);
        self::assertSame('pattern', is_array($names['body.label'] ?? null) ? ($names['body.label']['Regex'] ?? null) : null);
    }

    /**
     * @param array<string, mixed> $body
     * @return list<array{string, string, string}>
     */
    private function issues(array $body, string $namespace = self::NATIVE_NAMESPACE): array
    {
        return $this->issuesOfJson(json_encode((object) $body, JSON_THROW_ON_ERROR | JSON_PRESERVE_ZERO_FRACTION), $namespace);
    }

    /**
     * The generated rules' issues, then Laravel's own failures named with the contract rule `NATIVE_RULE_NAMES` gives.
     *
     * @param array<string, string> $path the path values, the reference channel id when empty
     * @param array<string, string> $query
     * @return list<array{string, string, string}>
     */
    private function issuesOfJson(string $json, string $namespace = self::NATIVE_NAMESPACE, array $path = [], array $query = []): array
    {
        [$issues, $validator] = $this->validate($json, $namespace, $path, $query);
        $names = constant("{$namespace}\\GetTasksBatchRequest::NATIVE_RULE_NAMES");
        self::assertIsArray($names);

        foreach ($validator->failed() as $attribute => $rules) {
            $key = preg_replace('/\.\d+(?=\.|$)/', '.*', (string) $attribute);
            $segments = explode('.', (string) $attribute);
            $part = array_shift($segments);
            foreach (array_keys(is_array($rules) ? $rules : []) as $laravelRule) {
                $contractRule = is_array($names[$key] ?? null) ? ($names[$key][$laravelRule] ?? null) : null;
                if (is_string($contractRule)) {
                    $issues[] = [$part, '/' . implode('/', $segments), $contractRule];
                }
            }
        }

        return $issues;
    }

    /**
     * @param array<string, mixed> $body
     * @return array<string, list<string>>
     */
    private function failed(array $body): array
    {
        [, $validator] = $this->validate(json_encode((object) $body, JSON_THROW_ON_ERROR), self::NATIVE_NAMESPACE);
        $failed = [];
        foreach ($validator->failed() as $attribute => $rules) {
            $failed[(string) $attribute] = array_map(strval(...), array_keys(is_array($rules) ? $rules : []));
        }

        return $failed;
    }

    /**
     * Runs the generated request's rules over `$json`; the generated request is loaded at run time, so its rules are
     * read through checks.
     *
     * @param array<string, string> $path
     * @param array<string, string> $query
     * @return array{list<array{string, string, string}>, \Illuminate\Validation\Validator}
     */
    private function validate(string $json, string $namespace, array $path = [], array $query = []): array
    {
        $contractRules = ["{$namespace}\\GetTasksBatchRequest", 'contractRules'];
        self::assertIsCallable($contractRules);

        $tree = InputTree::withBody($path === [] ? ['channelId' => self::CHANNEL_ID] : $path, $query, [], json_decode($json, false, 512, JSON_THROW_ON_ERROR));
        $rules = $contractRules($tree);
        self::assertIsArray($rules);

        $factory = new Factory(new Translator(new ArrayLoader(), 'en'));
        $validator = $factory->make($tree->validationData(), $rules);
        $validator->passes();

        $issues = array_map(static fn (ContractIssue $issue): array => [$issue->in, $issue->pointer, $issue->rule], $tree->issues());

        return [$issues, $validator];
    }

    private static function withAddedMembers(\stdClass $document): \stdClass
    {
        $schemas = get_object_vars($document)['schemas'] ?? null;
        $schema = $schemas instanceof \stdClass ? (get_object_vars($schemas)['GetTasksBatchInput'] ?? null) : null;
        if (!$schema instanceof \stdClass || !is_array($schema->properties) || !$schema->properties[0] instanceof \stdClass) {
            throw new \LogicException('The reference IR has no GetTasksBatchInput object schema.');
        }

        $template = $schema->properties[0];
        $added = [
            ['note', true, true, ['kind' => 'scalar', 'type' => 'string', 'refinements' => new \stdClass()]],
            ['count', true, false, ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['minimum' => '1', 'maximum' => '10']]],
            ['ratio', true, false, ['kind' => 'scalar', 'type' => 'number', 'refinements' => new \stdClass()]],
            ['label', true, false, ['kind' => 'scalar', 'type' => 'string', 'refinements' => ['minLength' => 5, 'pattern' => ['source' => '^tag-', 'normalized' => '^tag-']]]],
            ['step', true, false, ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['multipleOf' => '3']]],
            ['halfStep', true, false, ['kind' => 'scalar', 'type' => 'integer', 'refinements' => ['multipleOf' => '2.5']]],
            ['payload', true, false, ['kind' => 'opaque', 'reason' => 'any webhook payload', 'origin' => ['layer' => 'api', 'pointer' => '/schemas/GetTasksBatchInput/properties/payload']]],
            ['nullablePayload', true, true, ['kind' => 'opaque', 'reason' => 'any webhook payload', 'origin' => ['layer' => 'api', 'pointer' => '/schemas/GetTasksBatchInput/properties/nullablePayload']]],
        ];
        foreach ($added as [$name, $optional, $nullable, $type]) {
            $property = clone $template;
            unset($property->derivedFrom);
            $property->name = $name;
            $property->optional = $optional;
            $property->nullable = $nullable;
            $property->type = json_decode(json_encode($type, JSON_THROW_ON_ERROR), false, 512, JSON_THROW_ON_ERROR);
            $schema->properties[] = $property;
        }

        return $document;
    }
}
