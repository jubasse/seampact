import reservedWords from "../../packages/core/spec/vectors/naming/reserved-words.json" with {
  type: "json",
};

// The reserved-word lists of ADR 0007 section 5 as source files of the native naming (ADR 0010): the Kotlin and Java
// lists for Kotlin, the PHP list for PHP. The algorithm around them is written by hand in each language; the lists
// are generated so that a list change reaches them with the vectors.

export const KOTLIN_NAMING_DIRECTORY =
  "jvm/seampact-ir/src/main/kotlin/io/github/jubasse/seampact/ir/naming";

export const PHP_NAMING_DIRECTORY = "php/ir/src/Naming";

const KOTLIN_PACKAGE = "io.github.jubasse.seampact.ir.naming";
const PHP_NAMESPACE = "Seampact\\Ir\\Naming";

const WORDS_PER_LINE = 6;

const LIST_KEYS = ["keywords", "types", "members", "enumMembers"] as const;

type ListKey = (typeof LIST_KEYS)[number];

interface ReservedList {
  usedBy: string[];
  caseInsensitive: boolean;
  keywords: string[];
  types: string[];
  members: string[];
  enumMembers: string[];
}

function listOf(language: string): ReservedList {
  const found = Object.values(reservedWords.lists).find((list) => list.usedBy.includes(language));

  if (found === undefined) throw new Error(`reserved-words.json: no list for ${language}`);

  return found;
}

function wordsOf(list: ReservedList, key: ListKey): string[] {
  const words = [...list[key]].sort();

  for (const word of words)
    if (!/^[A-Za-z0-9_]+$/.test(word))
      throw new Error(`reserved-words.json: ${JSON.stringify(word)} is not an identifier`);

  return words;
}

function chunked(words: string[]): string[][] {
  const lines: string[][] = [];

  for (let start = 0; start < words.length; start += WORDS_PER_LINE)
    lines.push(words.slice(start, start + WORDS_PER_LINE));

  return lines;
}

const header = (regenerateCommand: string, comment: string): string[] => [
  `${comment} Generated from packages/core/spec/vectors/naming/reserved-words.json by scripts/ir-models. Do not edit.`,
  `${comment} Regenerate: ${regenerateCommand}`,
];

function kotlinListLines(name: string, list: ReservedList): string[] {
  const set = (key: ListKey): string[] => {
    const lines = chunked(wordsOf(list, key)).map(
      (words) => `        ${words.map((word) => `"${word}"`).join(", ")},`,
    );

    return lines.length === 0 ? ["    emptySet(),"] : ["    setOf(", ...lines, "    ),"];
  };

  return [
    `internal val ${name}: ReservedList = ReservedList(`,
    `    caseInsensitive = ${list.caseInsensitive},`,
    ...LIST_KEYS.flatMap((key) => {
      const lines = set(key);

      return [`    ${key} =`, ...lines.map((line) => `    ${line}`)];
    }),
    ")",
  ];
}

function kotlinReservedWords(regenerateCommand: string): string {
  const lines = [
    ...header(regenerateCommand, "//"),
    "",
    `package ${KOTLIN_PACKAGE}`,
    "",
    "/** The reserved and shadowed names of one language (ADR 0007 section 5). */",
    "internal class ReservedList(",
    "    val caseInsensitive: Boolean,",
    "    val keywords: Set<String>,",
    "    val types: Set<String>,",
    "    val members: Set<String>,",
    "    val enumMembers: Set<String>,",
    ")",
    "",
    ...kotlinListLines("KOTLIN_RESERVED_WORDS", listOf("kotlin")),
    "",
    ...kotlinListLines("JAVA_RESERVED_WORDS", listOf("java")),
  ];

  return `${lines.join("\n")}\n`;
}

const PHP_METHODS: Record<ListKey, string> = {
  keywords: "keywords",
  types: "types",
  members: "members",
  enumMembers: "enumMembers",
};

function phpReservedWords(regenerateCommand: string): string {
  const list = listOf("php");
  const methods = LIST_KEYS.flatMap((key) => {
    const lines = chunked(wordsOf(list, key)).map(
      (words) => `        ${words.map((word) => `'${word}'`).join(", ")},`,
    );

    return [
      "",
      "    /** @return list<string> */",
      `    public static function ${PHP_METHODS[key]}(): array`,
      "    {",
      ...(lines.length === 0
        ? ["        return [];"]
        : ["        return [", ...lines.map((line) => `    ${line}`), "        ];"]),
      "    }",
    ];
  });
  const lines = [
    "<?php",
    "",
    ...header(regenerateCommand, "//"),
    "",
    "declare(strict_types=1);",
    "",
    `namespace ${PHP_NAMESPACE};`,
    "",
    "/** The reserved and shadowed names of PHP (ADR 0007 section 5). */",
    "final class ReservedWords",
    "{",
    "    public static function caseInsensitive(): bool",
    "    {",
    `        return ${list.caseInsensitive ? "true" : "false"};`,
    "    }",
    ...methods,
    "}",
  ];

  return `${lines.join("\n")}\n`;
}

/** The generated naming files, by repository path. */
export function emitNamingLists(regenerateCommand: string): Map<string, string> {
  return new Map([
    [`${KOTLIN_NAMING_DIRECTORY}/ReservedWords.kt`, kotlinReservedWords(regenerateCommand)],
    [`${PHP_NAMING_DIRECTORY}/ReservedWords.php`, phpReservedWords(regenerateCommand)],
  ]);
}
