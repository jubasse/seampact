"""What steps 2 to 5 hold of one request renders without the body, its proofs, the principal or the scopes, so an
error tracker that captures frame locals by `repr` never shows them."""

import json
from pathlib import Path

from seampact.codegen.runtime.access_steps import AccessState
from seampact.codegen.runtime.contract import ApiContract
from seampact.hooks import RequestView, ResolvedScope


def test_the_access_state_repr_shows_no_body_principal_or_scope(repository_root: Path) -> None:
    ir_view = json.loads((repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8"))
    contract = ApiContract(
        api="tasks", generated_by="0.0.0-dev", mount="", ir_view=ir_view, members={}, operation_members={}
    )
    state = AccessState(
        contract=contract,
        operation_id="purgeTask",
        credentials_types={},
        raw_parameters={"taskId": "task-of-alice"},
        request=RequestView(method="POST", path="/v1/channels/c/tasks/t/purge", headers={}),
        body={"reauthToken": "hunter2"},
        principal="principal-alice",
        scopes=[ResolvedScope(scope="channel", id="channel-of-alice")],
    )

    rendered = repr(state)

    for secret in ("hunter2", "principal-alice", "channel-of-alice"):
        assert secret not in rendered
