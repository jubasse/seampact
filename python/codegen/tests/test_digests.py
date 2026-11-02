"""The digests write the text `JSON.stringify` writes, with sorted members, so an idempotency key, a throttle key and
an ETag are equal across targets; the vectors are the PHP, Spring and Node targets'."""

import json

from seampact.codegen.runtime.digests import canonical, hex_of


def test_idempotency_key_parts_digest_as_on_the_node_targets() -> None:
    assert hex_of(["tasks", "createTask", "user", "", "key-1"]) == (
        "0e9711dfe19de9076c70514c7d5204e8816596cd427904fc6d562b0bbbc20cb4"
    )


def test_canonical_text_sorts_members_and_writes_numbers_and_escapes_as_javascript() -> None:
    value = json.loads('{"b":1.5,"a":[1e21,1e-7,0.000001,-2,100],"é":"line\\nbreak\\u0001\\"q\\"","Z":true,"_":null}')

    assert (
        canonical(value)
        == '{"Z":true,"_":null,"a":[1e+21,1e-7,0.000001,-2,100],"b":1.5,"é":"line\\nbreak\\u0001\\"q\\""}'
    )
    assert hex_of([value]) == "8418156b997e15c2cacd6ae3aa6e1a0bc3a66cfae86c8eca7147160fce9bc420"


def test_canonical_text_writes_index_like_member_names_first_as_javascript() -> None:
    value = json.loads('{"b":3,"10":1,"9":2,"4294967295":4,"01":5,"4294967294":6,"-1":7}')

    assert canonical(value) == '{"9":2,"10":1,"4294967294":6,"-1":7,"01":5,"4294967295":4,"b":3}'
    assert hex_of([value]) == "c7792be0e4e3e7cc71460895bde011d733bcbb0c495cbb3fd0540a551aff078b"


def test_fractions_and_large_integral_floats_are_written_plain() -> None:
    assert canonical([0.5, -0.25, 123456.789, 1e300, 2.5e-9, -0.0]) == "[0.5,-0.25,123456.789,1e+300,2.5e-9,0]"
