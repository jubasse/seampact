<?php

declare(strict_types=1);

namespace Seampact\Ir\Config;

/** The two kinds of `seampact.config.yaml` (ADR 0011 "The app config"): an app's, or a monorepo root's. */
enum ConfigKind: string
{
    case App = 'app config';
    case Root = 'root config';

    public function articled(): string
    {
        return "a {$this->value}";
    }

    /** The schema of this kind, in `resources/schemas/config/`. */
    public function schemaFile(): string
    {
        return $this === self::App ? 'app.schema.json' : 'root.schema.json';
    }
}
