<?php

declare(strict_types=1);

namespace Seampact\Laravel;

/** How the app registers the contract routes: `Route::seampact()` in its own routes file, or a generated `routes.php`. */
enum RoutesForm: string
{
    case Macro = 'macro';
    case File = 'file';
}
