// The pack variants of the reference contract: one directory per first-party pack under
// `fixtures/golden/pack-<name>/contract`, the reference with the pack listed in its shared file and, for a pack
// that sets a paging style, the reference's own style removed so the pack's defaults apply (a later layer wins,
// ADR 0002 section 3). The edits are data; a stale copy fails `--check`.

const SHARED_FILE = "shared/base.yaml";
const TASKS_FILE = "tasks/api.yaml";

interface TextEdit {
  file: string;
  /** The text to replace; it must occur exactly once. */
  find: string;
  replace: string;
}

export interface PackVariant {
  /** The pack's directory name, `pack-<name>` under `fixtures/golden`. */
  name: string;
  edits: TextEdit[];
}

const SHARED_HEADER = "# shared/base.yaml: the workspace's shared file, seen by both apis\n";
const SHARED_PAGING = "  paging: { default: cursor, maxLimit: 100 }\n";
const TASKS_LIST_PAGING = "paging: { cursor: { maxLimit: 50 } }";
const TASKS_LIST_SORTABLE = "                  sortable: [createdAt]\n";

function listPack(name: string): TextEdit {
  return {
    file: SHARED_FILE,
    find: SHARED_HEADER,
    replace: `${SHARED_HEADER}packs: ['@seampact/pack-${name}']\n`,
  };
}

/** The pack's own paging default applies: the shared default goes and the tasks list names the pack's style. */
function usePagingStyle(style: string): TextEdit[] {
  return [
    { file: SHARED_FILE, find: SHARED_PAGING, replace: "  paging: { maxLimit: 100 }\n" },
    {
      file: TASKS_FILE,
      find: TASKS_LIST_PAGING,
      replace: `paging: { ${style}: { maxLimit: 50 } }`,
    },
  ];
}

/** A paging style with no sort role cannot send the sort keys the tasks list declares. */
const DROP_LIST_SORT: TextEdit = { file: TASKS_FILE, find: TASKS_LIST_SORTABLE, replace: "" };

/** The search example would render `$self`, `$resource` and a merge, which the examples do not generate yet. */
const DROP_SEARCH_EXAMPLES: TextEdit = {
  file: "tasks/routes/tasks/search.yaml",
  find: "examples:\n  firstPage: { status: 200, value: { $file: ../../examples/search-200.json } }\n",
  replace: "",
};

export const PACK_VARIANTS: readonly PackVariant[] = [
  { name: "crud-rights", edits: [listPack("crud-rights")] },
  {
    name: "laravel",
    edits: [listPack("laravel"), ...usePagingStyle("laravelPages"), DROP_LIST_SORT],
  },
  { name: "hal", edits: [listPack("hal"), ...usePagingStyle("halPages"), DROP_SEARCH_EXAMPLES] },
  {
    name: "api-platform",
    edits: [listPack("api-platform"), ...usePagingStyle("hydra"), DROP_SEARCH_EXAMPLES],
  },
  { name: "spring", edits: [listPack("spring"), ...usePagingStyle("springPage")] },
];

function applyEdit(text: string, edit: TextEdit, variant: string): string {
  const occurrences = text.split(edit.find).length - 1;

  if (occurrences !== 1) {
    throw new Error(
      `pack variant ${variant}: '${edit.find.trim()}' occurs ${occurrences} times in ${edit.file}, expected once`,
    );
  }

  return text.replace(edit.find, () => edit.replace);
}

/**
 * The variant contracts, keyed by repository-relative path, from the reference files (keyed by path under the
 * reference) and the golden directory they are written under.
 */
export function packVariantFiles(
  reference: ReadonlyMap<string, string>,
  goldenDirectory: string,
): Map<string, string> {
  const generated = new Map<string, string>();

  for (const variant of PACK_VARIANTS) {
    // A Windows checkout gives the reference CRLF line ends; the edits and the committed variants are LF.
    const files = new Map(
      [...reference].map(([file, text]) => [file, text.replace(/\r\n/g, "\n")]),
    );

    for (const edit of variant.edits) {
      const text = files.get(edit.file);

      if (text === undefined) throw new Error(`pack variant ${variant.name}: no file ${edit.file}`);

      files.set(edit.file, applyEdit(text, edit, variant.name));
    }

    for (const [file, text] of files) {
      generated.set(`${goldenDirectory}/pack-${variant.name}/contract/${file}`, text);
    }
  }

  return generated;
}
