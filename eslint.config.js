// Blank-line padding rule, the one thing Biome cannot enforce; Biome handles everything else.
import stylistic from "@stylistic/eslint-plugin";
import typescriptParser from "typescript-eslint";

const blankLineAlways = (prev, next) => ({ blankLine: "always", prev, next });

export default [
  {
    ignores: [
      ".work/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/build/**",
      "php/**/vendor/**",
      "packages/core/spec/schemas/authoring/**",
      "packages/core/spec/src/authoring/grammar.snapshot.json",
    ],
  },
  {
    files: ["**/*.{ts,tsx,mts,cts,js,mjs,cjs}"],
    languageOptions: { parser: typescriptParser.parser },
    plugins: { "@stylistic": stylistic },
    rules: {
      "@stylistic/padding-line-between-statements": [
        "error",
        blankLineAlways("*", ["return", "if", "for", "while", "do", "switch", "try", "throw"]),
        blankLineAlways(["const", "let", "var"], "*"),
        { blankLine: "any", prev: ["const", "let", "var"], next: ["const", "let", "var"] },
        blankLineAlways("block-like", "*"),
      ],
    },
  },
];
