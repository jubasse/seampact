<?php

declare(strict_types=1);

namespace Seampact\Symfony\Tests;

use PHPUnit\Framework\TestCase;
use Seampact\Codegen\Tests\Support\ReferenceContract;
use Seampact\Golden\TasksConsistent\Schemas\Task as ConsistentTask;
use Seampact\Golden\TasksConsistent\Schemas\TaskSearchResult;
use Seampact\Golden\TasksConsistent\Schemas\TaskState as ConsistentTaskState;
use Seampact\Golden\Tasks\Schemas\Task;
use Seampact\Golden\Tasks\Schemas\TaskState;
use Seampact\Symfony\SymfonyGenerator;
use Symfony\Component\Validator\ConstraintViolationInterface;
use Symfony\Component\Validator\Validation;
use Symfony\Component\Validator\Validator\ValidatorInterface;

/** The Symfony Validator attributes of the golden schema classes, read by the real validator as an app reads them. */
final class SchemaConstraintsTest extends TestCase
{
    private static int $loadedTaskClasses = 0;

    public function testAValidSchemaObjectHasNoViolation(): void
    {
        self::assertSame([], self::violatedPaths(self::task('Write the report', 1)));
    }

    public function testAnInvalidSchemaObjectHasOneViolationPerBrokenRule(): void
    {
        self::assertSame(['title', 'version'], self::violatedPaths(self::task('', 0)));
    }

    public function testTheObjectsOfAListAreValidated(): void
    {
        $consistentTask = new ConsistentTask('6f1d2c34-0000-4000-8000-000000000001', '', ConsistentTaskState::Open, null, 1, new \DateTimeImmutable());

        self::assertSame(['items[0].title'], self::violatedPaths(new TaskSearchResult([$consistentTask], 1)));
    }

    public function testAPatternIsARegexUnderNativeRulesOnly(): void
    {
        $regex = "#[Assert\\NotNull, Assert\\Length(min: 1, max: 200), Assert\\Regex(pattern: '/^[A-Z]/u')]";

        self::assertStringContainsString($regex, self::taskClassWithTitlePattern([]));
        self::assertStringNotContainsString('Regex', self::taskClassWithTitlePattern(['rules' => 'seampact-consistent']));
    }

    public function testAPatternNoRegexCanWriteIsNamedOnTheClassAndNeverRefused(): void
    {
        $taskClass = self::taskClassWithTitlePattern([], '^[/#~%!@;,]+$');

        self::assertStringContainsString("Member 'title' has no Symfony attribute for its pattern, which holds every PCRE delimiter.", $taskClass);
        self::assertStringNotContainsString('Regex', $taskClass);
    }

    public function testAStringRuleOnADateTimeMemberLeavesAValidObjectValid(): void
    {
        $taskClass = self::loadedTaskClass([], 'createdAt', ['maxLength' => 40, 'pattern' => (object) ['normalized' => '^2', 'source' => '^2']]);
        $taskState = $taskClass . 'State';
        $task = new $taskClass('6f1d2c34-0000-4000-8000-000000000001', 'Write the report', $taskState::Open, null, 1, new \DateTimeImmutable());

        self::assertSame([], self::violatedPaths($task));
    }

    public function testAPatternThatRefusesTheEmptyStringRefusesItInBothModes(): void
    {
        foreach ([[], ['rules' => 'seampact-consistent']] as $options) {
            $taskClass = self::loadedTaskClass($options, 'title', ['minLength' => null, 'pattern' => (object) ['normalized' => '^[A-Z]', 'source' => '^[A-Z]']]);
            $taskState = $taskClass . 'State';

            self::assertSame(['title'], self::violatedPaths(new $taskClass('6f1d2c34-0000-4000-8000-000000000001', '', $taskState::Open, null, 1, new \DateTimeImmutable())));
            self::assertSame(['title'], self::violatedPaths(new $taskClass('6f1d2c34-0000-4000-8000-000000000001', 'lower', $taskState::Open, null, 1, new \DateTimeImmutable())));
            self::assertSame([], self::violatedPaths(new $taskClass('6f1d2c34-0000-4000-8000-000000000001', 'Upper', $taskState::Open, null, 1, new \DateTimeImmutable())));
        }
    }

    /** @param array<string, string> $options */
    private static function taskClassWithTitlePattern(array $options, string $pattern = '^[A-Z]'): string
    {
        return self::taskSchemaFiles($options, 'title', ['pattern' => (object) ['normalized' => $pattern, 'source' => $pattern]])['Task'];
    }

    /**
     * The generated Task class and its TaskState enum, declared in a namespace of their own; returns the class name.
     *
     * @param array<string, string> $options
     * @param array<string, mixed> $refinements
     * @return class-string
     */
    private static function loadedTaskClass(array $options, string $propertyName, array $refinements): string
    {
        self::$loadedTaskClasses++;
        $namespace = 'App\\Probe' . self::$loadedTaskClasses;

        foreach (self::taskSchemaFiles($options, $propertyName, $refinements, $namespace) as $contents) {
            eval(substr($contents, strlen('<?php')));
        }

        $taskClass = "{$namespace}\\Schemas\\Task";
        if (!class_exists($taskClass)) {
            self::fail("The generated {$taskClass} did not load.");
        }

        return $taskClass;
    }

    /**
     * The generated Task and TaskState files, after `$refinements` replaced those of Task's `$propertyName`.
     *
     * @param array<string, string> $options
     * @param array<string, mixed> $refinements
     * @return array{Task: string, TaskState: string}
     */
    private static function taskSchemaFiles(array $options, string $propertyName, array $refinements, string $namespace = 'App\\Tasks'): array
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation, \stdClass $document) use ($propertyName, $refinements): void {
            $task = $document->schemas instanceof \stdClass ? $document->schemas->Task : null;
            if (!$task instanceof \stdClass || !is_array($task->properties)) {
                throw new \LogicException('The reference IR has no Task schema.');
            }

            foreach ($task->properties as $property) {
                if ($property instanceof \stdClass && $property->name === $propertyName && $property->type instanceof \stdClass) {
                    $property->type->refinements = (object) array_filter([...(array) ($property->type->refinements ?? []), ...$refinements], static fn (mixed $value): bool => $value !== null);
                }
            }
        });
        $files = (new SymfonyGenerator())->generate(ReferenceContract::read(new SymfonyGenerator(), $document), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', $namespace, $options));

        $contents = [];
        foreach ($files as $file) {
            if (in_array($file->path, ['Schemas/Task.php', 'Schemas/TaskState.php'], true)) {
                $contents[basename($file->path, '.php')] = $file->contents;
            }
        }
        if (!isset($contents['Task'], $contents['TaskState'])) {
            self::fail('The tasks api has no Schemas/Task.php or Schemas/TaskState.php.');
        }

        return ['Task' => $contents['Task'], 'TaskState' => $contents['TaskState']];
    }

    private static function task(string $title, int $version): Task
    {
        return new Task('6f1d2c34-0000-4000-8000-000000000001', $title, TaskState::Open, null, $version, new \DateTimeImmutable());
    }

    /** @return list<string> */
    private static function violatedPaths(object $value): array
    {
        $violations = iterator_to_array(self::validator()->validate($value), false);

        return array_map(static fn (ConstraintViolationInterface $violation): string => $violation->getPropertyPath(), $violations);
    }

    private static function validator(): ValidatorInterface
    {
        return Validation::createValidatorBuilder()->enableAttributeMapping()->getValidator();
    }
}
