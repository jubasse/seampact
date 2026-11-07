"""The framework-free runtime of generated Python code: step 1's raw-target match and decoding, the wire codec,
replies, the outgoing verdict, the pattern check, the runtime version (G3) and the sync driver of the steps, which
are written once as coroutines. A placement (FastAPI, Django) reads the request and writes the reply around them."""

from seampact.codegen.runtime.version import RUNTIME_VERSION

__all__ = ["RUNTIME_VERSION"]
