"""FastAPI's own document as the entry asks (ADR 0026 "Native docs"): with `nativeDocs`, `/openapi.json` describes
each contract route with seampact's operation object at the path it serves; with `frameworkDocs: off`, FastAPI's
documentation routes are gone. The api is the golden `tasks` api, generated into a temporary package."""

import copy
import dataclasses
import importlib
import sys
import uuid
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path

import fastapi
import pytest
from fastapi.testclient import TestClient

from seampact.codegen.native_docs_file import reached_components
from seampact.codegen.runtime.native_docs import NativeDocs, NativeDocsError, NativeOperation, read_native_docs
from seampact.fastapi.generator import FastApiGenerator
from seampact.fastapi.runtime import ApiBinding, FrameworkDocs
from seampact.fastapi.runtime.framework_document import complete_framework_document
from seampact.ir.config.json_value import JsonObject, JsonValue
from seampact.ir.config.yaml_reader import parse_config_text
from seampact.ir.read import read_ir
from seampact.ir.run.generator import FrameworkDocs as EntryFrameworkDocs
from seampact.ir.run.generator import GenerationRefusedError, NativeDocsDocument

from .test_golden import reference_entry

_DOCUMENT = "full"
_DOCS_ROUTES = ("/openapi.json", "/docs", "/redoc", "/docs/oauth2-redirect")

type GeneratedApp = Callable[..., fastapi.FastAPI]


@pytest.fixture
def seampact_document(repository_root: Path) -> JsonObject:
    text = (repository_root / f"fixtures/golden/reference/openapi/tasks.{_DOCUMENT}.yaml").read_text(encoding="utf-8")
    tree = parse_config_text(text, "tasks.full.yaml")
    assert not isinstance(tree, list) and isinstance(tree.value, dict)

    return tree.value


@pytest.fixture
def generated_app(repository_root: Path, tmp_path: Path) -> Iterator[GeneratedApp]:
    """Generates the golden `tasks` api with the entry's artefacts and `frameworkDocs`, then binds it into an app."""
    packages: list[str] = []

    def app_of(
        artefacts: dict[str, JsonValue],
        framework_docs: EntryFrameworkDocs = EntryFrameworkDocs.KEEP,
        native_docs: NativeDocsDocument | None = None,
    ) -> fastapi.FastAPI:
        generator = FastApiGenerator()
        text = (repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8")
        entry = dataclasses.replace(
            reference_entry("tasks", artefacts=artefacts), framework_docs=framework_docs, native_docs=native_docs
        )
        files = generator.generate(read_ir(text, generator.ir_support()), entry)
        package = f"native_docs_{uuid.uuid4().hex}"
        packages.append(package)
        (tmp_path / package).mkdir()

        for file in files:
            (tmp_path / package / file.path).write_text(file.contents, encoding="utf-8")

        placement = importlib.import_module(f"{package}.fastapi")
        app = fastapi.FastAPI()
        handlers = placement.TasksHandlerFactories(
            tasks=object, drafts=object, channels=object, preferences=object, app=object, hooks=object
        )
        placement.bind_tasks(app, handlers=handlers)
        binding = app.user_middleware[0].kwargs["binding"]
        assert isinstance(binding, ApiBinding)
        binding.boot_problems = []

        return app

    sys.path.insert(0, str(tmp_path))
    yield app_of
    sys.path.remove(str(tmp_path))

    for name in [name for name in sys.modules if name.split(".")[0] in packages]:
        del sys.modules[name]


def _member(document: Mapping[str, object], key: str) -> dict[str, object]:
    value = document.get(key)
    assert isinstance(value, dict)

    return value


def _operations_by_id(document: Mapping[str, object]) -> dict[str, object]:
    paths = _member(document, "paths")

    return {
        operation["operationId"]: operation
        for path in paths
        for operation in _member(paths, path).values()
        if isinstance(operation, dict) and "operationId" in operation
    }


def test_nativedocs_puts_seampacts_operation_objects_into_fastapis_document(
    generated_app: GeneratedApp, seampact_document: JsonObject
) -> None:
    native = NativeDocsDocument(_DOCUMENT, seampact_document)
    client = TestClient(generated_app({"nativeDocs": True}, native_docs=native))

    served = client.get("/openapi.json").json()

    seampact_operations = _operations_by_id(seampact_document)
    assert _operations_by_id(served) == seampact_operations
    assert _member(served, "paths") == _member(seampact_document, "paths")
    reached = reached_components(
        [{"operation": operation} for operation in seampact_operations.values()],
        _member(seampact_document, "components"),
    )
    assert _member(reached, "schemas").items() <= _member(_member(served, "components"), "schemas").items()
    assert client.get("/docs").status_code == 200


def test_without_nativedocs_fastapis_document_holds_no_contract_route(generated_app: GeneratedApp) -> None:
    client = TestClient(generated_app({}))

    assert client.get("/openapi.json").json().get("paths", {}) == {}


def test_frameworkdocs_off_serves_none_of_fastapis_documentation_routes(generated_app: GeneratedApp) -> None:
    client = TestClient(generated_app({}, framework_docs=EntryFrameworkDocs.OFF))

    assert [client.get(path).status_code for path in _DOCS_ROUTES] == [404] * len(_DOCS_ROUTES)


def test_a_component_the_apps_document_holds_with_another_value_is_refused_naming_it(
    generated_app: GeneratedApp,
) -> None:
    app = generated_app({})
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)
    clashing: dict[str, dict[str, object]] = {"schemas": {"HTTPValidationError": {"type": "string"}}}
    operations = {
        route.operation_id: NativeOperation("/v1/health", "get", {"operationId": route.operation_id})
        for route in binding.placement.routes
    }

    @app.get("/v2/form")
    def form(item: int) -> int:
        return item

    complete_framework_document(binding, NativeDocs(operations, clashing))

    with pytest.raises(NativeDocsError, match="component schemas 'HTTPValidationError'"):
        app.openapi()


def _refusal_codes(
    artefacts: dict[str, JsonValue], native: NativeDocsDocument | None, repository_root: Path
) -> set[str]:
    generator = FastApiGenerator()
    text = (repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8")
    entry = dataclasses.replace(reference_entry("tasks", artefacts=artefacts), native_docs=native)

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(read_ir(text, generator.ir_support()), entry)

    return {problem.code for problem in refused.value.problems}


def test_nativedocs_without_a_document_or_with_a_document_lacking_an_operation_is_refused_by_name(
    repository_root: Path,
) -> None:
    empty = NativeDocsDocument(_DOCUMENT, {"openapi": "3.1.0", "paths": {}})

    assert _refusal_codes({"nativeDocs": True}, None, repository_root) == {"artefacts.nativeDocs.document-missing"}
    assert _refusal_codes({"nativeDocs": True}, empty, repository_root) == {"artefacts.nativeDocs.operation-missing"}


def test_the_framework_docs_switch_of_the_runtime_matches_the_entrys() -> None:
    assert [item.value for item in FrameworkDocs] == [item.value for item in EntryFrameworkDocs]


def test_only_the_components_the_operations_reach_are_kept() -> None:
    task: JsonValue = {"properties": {"owner": {"$ref": "#/components/schemas/User"}}}
    components: JsonObject = {
        "schemas": {
            "Task": task,
            "User": {"type": "object"},
            "Unused": {"type": "string"},
        },
        "responses": {"Problem": {"description": "problem"}, "Other": {"description": "other"}},
        "securitySchemes": {"user": {"type": "http", "scheme": "bearer"}, "service": {"type": "apiKey"}},
    }
    operation: JsonValue = {
        "operation": {
            "security": [{"user": []}],
            "responses": {
                "200": {"content": {"application/json": {"schema": {"$ref": "#/components/schemas/Task"}}}},
                "default": {"$ref": "#/components/responses/Problem"},
            },
        }
    }

    assert reached_components([operation], components) == {
        "responses": {"Problem": {"description": "problem"}},
        "schemas": {"Task": task, "User": {"type": "object"}},
        "securitySchemes": {"user": {"type": "http", "scheme": "bearer"}},
    }


def test_a_contract_route_missing_from_native_docs_json_fails_at_boot_naming_the_fix(
    generated_app: GeneratedApp,
) -> None:
    app = generated_app({})
    binding = app.user_middleware[0].kwargs["binding"]
    assert isinstance(binding, ApiBinding)

    with pytest.raises(NativeDocsError, match=r"no operation '.+'.*run `seampact generate`"):
        complete_framework_document(binding, NativeDocs({}, {}))


def test_a_native_docs_json_operation_without_a_path_or_method_does_not_read(tmp_path: Path) -> None:
    file = tmp_path / "native_docs.json"
    file.write_text('{"operations": {"health": {"operation": {}}}, "components": {}}', encoding="utf-8")

    with pytest.raises(NativeDocsError, match=r"'health'.*'path'.*run `seampact generate`"):
        read_native_docs(file)


def test_a_contract_schema_named_like_a_fastapi_component_is_refused_with_a_fix_that_applies(
    repository_root: Path, seampact_document: JsonObject
) -> None:
    document = copy.deepcopy(seampact_document)
    operation = next(
        item
        for path in _member(document, "paths").values()
        for item in _member({"p": path}, "p").values()
        if isinstance(item, dict) and "operationId" in item
    )
    operation["x-clash"] = {"$ref": "#/components/schemas/HTTPValidationError"}
    _member(_member(document, "components"), "schemas")["HTTPValidationError"] = {"type": "string"}

    generator = FastApiGenerator()
    text = (repository_root / "fixtures/golden/reference/tasks.ir.json").read_text(encoding="utf-8")
    entry = dataclasses.replace(
        reference_entry("tasks", artefacts={"nativeDocs": True}), native_docs=NativeDocsDocument(_DOCUMENT, document)
    )

    with pytest.raises(GenerationRefusedError) as refused:
        generator.generate(read_ir(text, generator.ir_support()), entry)

    [problem] = refused.value.problems
    assert problem.code == "artefacts.nativeDocs.component-clash"
    assert "HTTPValidationError" in problem.message
    assert "FastAPI" in problem.message
    assert "rename the schema" in problem.fix
    assert "nativeDocs" in problem.fix
