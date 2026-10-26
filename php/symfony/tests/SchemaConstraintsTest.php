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

    /** @param array<string, string> $options */
    private static function taskClassWithTitlePattern(array $options, string $pattern = '^[A-Z]'): string
    {
        $document = ReferenceContract::withOperation('getTask', static function (\stdClass $operation, \stdClass $document) use ($pattern): void {
            $task = $document->schemas instanceof \stdClass ? $document->schemas->Task : null;
            if (!$task instanceof \stdClass || !is_array($task->properties)) {
                throw new \LogicException('The reference IR has no Task schema.');
            }

            foreach ($task->properties as $property) {
                $refinements = $property instanceof \stdClass && $property->name === 'title' && $property->type instanceof \stdClass ? $property->type->refinements : null;
                if ($refinements instanceof \stdClass) {
                    $refinements->pattern = (object) ['normalized' => $pattern, 'source' => $pattern];
                }
            }
        });
        $files = (new SymfonyGenerator())->generate(ReferenceContract::read(new SymfonyGenerator(), $document), ReferenceContract::entry(SymfonyGenerator::PACKAGE, 'tasks', 'App\\Tasks', $options));

        foreach ($files as $file) {
            if ($file->path === 'Schemas/Task.php') {
                return $file->contents;
            }
        }

        self::fail('The tasks api has no Schemas/Task.php.');
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
