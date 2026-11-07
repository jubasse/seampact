<?php

declare(strict_types=1);

namespace Seampact\Laravel;

use Illuminate\Console\Command;
use Seampact\Ir\Run\Command as SeampactCommand;
use Seampact\Laravel\Runtime\ContractServiceProvider;

/**
 * `php artisan seampact:generate`: runs `vendor/bin/seampact generate` from the app's base path, with its options, so
 * an app generates its contract code without leaving artisan.
 */
final class GenerateCommand extends Command
{
    /** @var string */
    protected $signature = ContractServiceProvider::GENERATE_COMMAND . ' {--force : Overwrite generated files edited by hand} {--config= : The seampact config file to read}';

    /** @var string */
    protected $description = 'Generate the contract code of every seampact target entry of the app.';

    public function handle(): int
    {
        $arguments = ['generate'];
        if ($this->option('force') === true) {
            $arguments[] = '--force';
        }
        $config = $this->option('config');
        if (is_string($config) && $config !== '') {
            array_push($arguments, '--config', $config);
        }

        $vendorDirectory = $this->laravel->basePath('vendor');
        $environment = array_filter(getenv(), is_string(...));

        return SeampactCommand::run($arguments, $this->laravel->basePath(), $vendorDirectory, $environment, STDOUT, STDERR);
    }
}
