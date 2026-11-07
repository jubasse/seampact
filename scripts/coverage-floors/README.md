# Coverage floors: `floors.json`, the lowest line and branch coverage each package may fall to, and `check.ts`, which checks a vitest, coverage.py or Cobertura summary against them in CI (the JVM build checks JaCoCo itself with `-PseampactCoverage`).

A summary that counts no line for a floored package fails by name (it would read as fully covered). The Python run lists the package directories of `python/pyproject.toml`, so a module no test imports reports 0% and lowers its member's numbers.
