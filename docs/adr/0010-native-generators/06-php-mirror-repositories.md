### PHP mirror repositories

PHP packages are developed under `php/<name>` in the monorepo (ADR 0009). A CI split job extracts each directory's history and pushes it to a read-only mirror repository, `jubasse/seampact-<name>`, with `composer.json` at its root and tags kept in step with the monorepo release (A19). The mirrors are created only before publication. Until then the job runs without pushing, and the produced trees are installed through Composer path repositories in CI to prove they are installable (CHK-088).
