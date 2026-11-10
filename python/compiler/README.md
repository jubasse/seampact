# seampact-compiler

The seampact compiler binary for one platform, installed with the seampact-ir[compiler] extra.

```sh
pip install "seampact-ir[compiler]"
```

Guide: https://jubasse.github.io/seampact/concepts/packages/

The seampact compiler binary for one platform, as a wheel: `seampact-ir[compiler]` installs it and runs it after checking its SHA-256 against the pins of `seampact-ir`. The macOS binaries are signed ad hoc only, which a pip install does not need.
