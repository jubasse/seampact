<?php

declare(strict_types=1);

namespace Seampact\Symfony;

use Seampact\Ir\Run\Command as SeampactCommand;
use Seampact\Symfony\Runtime\Regeneration;
use Symfony\Component\Console\Attribute\AsCommand;
use Symfony\Component\Console\Command\Command;
use Symfony\Component\Console\Input\InputInterface;
use Symfony\Component\Console\Input\InputOption;
use Symfony\Component\Console\Output\OutputInterface;

/**
 * `bin/console seampact:generate`: runs `vendor/bin/seampact generate` from the app's project directory, with its
 * options, so an app generates its contract code without leaving the console.
 */
#[AsCommand(name: Regeneration::COMMAND, description: 'Generate the contract code of every seampact target entry of the app.')]
final class GenerateCommand extends Command
{
    public function __construct(private readonly string $projectDirectory)
    {
        parent::__construct();
    }

    protected function configure(): void
    {
        $this->addOption('force', null, InputOption::VALUE_NONE, 'Overwrite generated files edited by hand');
        $this->addOption('config', null, InputOption::VALUE_REQUIRED, 'The seampact config file to read');
    }

    protected function execute(InputInterface $input, OutputInterface $output): int
    {
        $arguments = ['generate'];
        if ($input->getOption('force') === true) {
            $arguments[] = '--force';
        }
        $config = $input->getOption('config');
        if (is_string($config) && $config !== '') {
            array_push($arguments, '--config', $config);
        }

        $environment = array_filter(getenv(), is_string(...));

        return SeampactCommand::run($arguments, $this->projectDirectory, $this->projectDirectory . '/vendor', $environment, STDOUT, STDERR);
    }
}
