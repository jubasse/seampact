"""The manifest `seampact-bundle.json`, read from a document the manifest schema accepted."""

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class BundleLabel:
    name: str
    version: str


@dataclass(frozen=True, slots=True)
class BundleApi:
    name: str
    file: str
    ir_version: int
    ir_revision: int


@dataclass(frozen=True, slots=True)
class BundleFile:
    path: str
    size: int
    sha256: str


@dataclass(frozen=True, slots=True)
class BundleManifest:
    format_version: int
    contract: BundleLabel
    apis: tuple[BundleApi, ...]
    compiler: BundleLabel
    packs: tuple[BundleLabel, ...]
    files: tuple[BundleFile, ...]
    integrity: str


def manifest_of_schema_valid(document: object) -> BundleManifest:
    """The manifest of a document the schema accepted; a size such as `53.0` reads as the integer it is."""
    root = _object(document)

    return BundleManifest(
        format_version=_integer(root["formatVersion"]),
        contract=_label(root["contract"]),
        apis=tuple(
            BundleApi(_text(api["name"]), _text(api["file"]), _integer(api["irVersion"]), _integer(api["irRevision"]))
            for api in _objects(root["apis"])
        ),
        compiler=_label(root["compiler"]),
        packs=tuple(_label(pack) for pack in _objects(root["packs"])),
        files=tuple(
            BundleFile(_text(file["path"]), _integer(file["size"]), _text(file["sha256"]))
            for file in _objects(root["files"])
        ),
        integrity=_text(root["integrity"]),
    )


def _label(value: object) -> BundleLabel:
    label = _object(value)

    return BundleLabel(_text(label["name"]), _text(label["version"]))


def _objects(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise _not_schema_valid()

    return [_object(item) for item in value]


def _object(value: object) -> dict[str, object]:
    if not isinstance(value, dict):
        raise _not_schema_valid()

    return value


def _text(value: object) -> str:
    if not isinstance(value, str):
        raise _not_schema_valid()

    return value


def _integer(value: object) -> int:
    if isinstance(value, bool):
        raise _not_schema_valid()

    if isinstance(value, int):
        return value

    if isinstance(value, float) and value.is_integer():
        return int(value)

    raise _not_schema_valid()


def _not_schema_valid() -> ValueError:
    return ValueError("bundle: a manifest the schema accepted does not have the schema's shape.")
