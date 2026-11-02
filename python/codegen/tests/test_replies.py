"""The boundary's JSON bytes."""

import json

from seampact.codegen.runtime.replies import json_bytes


def test_a_lone_surrogate_echoed_from_the_request_is_written_escaped() -> None:
    echoed = json.loads('{"\\ud800": 1}')
    pointer = "/" + next(iter(echoed))

    written = json_bytes({"issues": [{"pointer": pointer}]})

    assert written == b'{"issues":[{"pointer":"/\\ud800"}]}'
    assert json.loads(written) == {"issues": [{"pointer": pointer}]}
