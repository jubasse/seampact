<?php

declare(strict_types=1);

namespace Seampact\Codegen\Tests;

use Nette\PhpGenerator\PsrPrinter;
use PHPUnit\Framework\TestCase;
use Seampact\Codegen\PhpTypes;
use Seampact\Codegen\Refusals;
use Seampact\Codegen\SchemaTypes;
use Seampact\Codegen\TypeNames;
use Seampact\Ir\Model\ContractIR;
use Seampact\Ir\Model\IrModelVersion;
use Seampact\Ir\Model\ObjectSchema;
use Seampact\Ir\Read\IrReader;
use Seampact\Ir\Read\IrSupport;

final class SchemaTypesTest extends TestCase
{
    public function testAnObjectIsAReadonlyClassWithFieldForAMemberBothOptionalAndNullable(): void
    {
        $ir = self::taskWithPublishOn();
        $files = $this->generated($ir);

        self::assertSame(['Task', 'TaskState'], array_keys($files));
        self::assertSame(<<<'PHP'
            <?php

            declare(strict_types=1);

            namespace App\Types;

            use DateTimeImmutable;
            use Seampact\Hooks\Field;

            /**
             * The schema 'Task'.
             */
            final readonly class Task
            {
                /**
                 * @param Field<DateTimeImmutable> $publishOn
                 */
                public function __construct(
                    public string $taskId,
                    public string $title,
                    public TaskState $state,
                    public ?int $effort,
                    public int $version,
                    public DateTimeImmutable $createdAt,
                    public Field $publishOn,
                ) {
                }
            }

            PHP, $files['Task']);
        self::assertStringContainsString("enum TaskState: string\n{\n    case Open = 'open';", $files['TaskState']);
    }

    /** @return array<string, string> */
    private function generated(ContractIR $ir): array
    {
        $task = $ir->schemas['Task'] ?? null;
        self::assertInstanceOf(ObjectSchema::class, $task);
        $names = new class implements TypeNames {
            public function schemaClass(string $schemaId): string
            {
                return 'App\\Types\\' . $schemaId;
            }

            public function enumClass(string $enumId): string
            {
                return 'App\\Types\\' . $enumId;
            }
        };
        $refusals = new Refusals('server', 'test', 'seampact/test');
        $classFiles = (new SchemaTypes($names, new PhpTypes($names), $refusals))->files(['TaskState' => $ir->enums['TaskState']], ['Task' => $task]);
        self::assertTrue($refusals->isEmpty());

        $printed = [];
        foreach ($classFiles as $file) {
            $printed[$file->shortName] = (new PsrPrinter())->printFile($file->file);
        }
        ksort($printed);

        return $printed;
    }

    private static function taskWithPublishOn(): ContractIR
    {
        $text = file_get_contents(dirname(__DIR__, 3) . '/fixtures/golden/reference/tasks.ir.json');
        self::assertIsString($text);
        $document = json_decode($text, false, 512, JSON_THROW_ON_ERROR);
        self::assertInstanceOf(\stdClass::class, $document);

        $schemas = get_object_vars($document)['schemas'];
        self::assertInstanceOf(\stdClass::class, $schemas);
        $task = get_object_vars($schemas)['Task'];
        self::assertInstanceOf(\stdClass::class, $task);
        self::assertIsArray($task->properties);
        self::assertInstanceOf(\stdClass::class, $task->properties[0]);
        $publishOn = clone $task->properties[0];
        self::assertInstanceOf(\stdClass::class, $publishOn);
        $publishOn->name = 'publishOn';
        $publishOn->optional = true;
        $publishOn->nullable = true;
        $publishOn->type = (object) ['kind' => 'scalar', 'type' => 'string', 'format' => 'date-time', 'refinements' => new \stdClass()];
        $task->properties[] = $publishOn;

        return IrReader::readDocument($document, new IrSupport([IrModelVersion::IR_VERSION], IrModelVersion::IR_REVISION, ['httpOperation'], []));
    }
}
