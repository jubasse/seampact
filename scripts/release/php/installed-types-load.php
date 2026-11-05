<?php

// The proof that a Composer package installed alone works: every class, interface and enum under its psr-4
// autoload loads from the installed copy through the project's own autoloader. The split job of p6-php-core and the
// release rehearsal run it on each package they install.
//   php scripts/release/php/installed-types-load.php <project-dir> <package>

declare(strict_types=1);

[, $project, $package] = $argv + [null, null, null];

if ($project === null || $package === null) {
    fwrite(STDERR, "usage: php scripts/release/php/installed-types-load.php <project-dir> <package>\n");
    exit(1);
}

require "$project/vendor/autoload.php";

$installed = json_decode(file_get_contents("$project/vendor/$package/composer.json"), true, flags: JSON_THROW_ON_ERROR);
$loaded = 0;

foreach ($installed["autoload"]["psr-4"] as $prefix => $directory) {
    $root = "$project/vendor/$package/" . rtrim($directory, "/");

    foreach (new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)) as $file) {
        $type = $prefix . str_replace("/", "\\", substr($file->getPathname(), strlen($root) + 1, -4));

        if (!class_exists($type) && !interface_exists($type) && !enum_exists($type)) {
            fwrite(STDERR, "$package: $type does not load from the installed copy.\n");
            exit(1);
        }

        $loaded++;
    }
}

if ($loaded === 0) {
    fwrite(STDERR, "$package: no type loads from the installed copy; check its psr-4 autoload.\n");
    exit(1);
}

echo "$package installs alone; $loaded types load.\n";
