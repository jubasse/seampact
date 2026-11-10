<!-- Generated from docs/getting-started/01-install.md by `node scripts/skills/cli.ts --write`. Edit the docs, not this file. -->

# Install

Page: https://jubasse.github.io/seampact/getting-started/01-install/

Install the `seampact` command from npm and start a project. This page is for a Node.js app. For Spring Boot, Laravel, Symfony, API Platform or Python, go to [install in other ecosystems](https://jubasse.github.io/seampact/getting-started/install-other-ecosystems/); [commands per stack](https://jubasse.github.io/seampact/features/commands-per-stack/) shows how each runs the commands.

You need Node.js 24 or later and npm.

## Create the folder

```sh
mkdir notes-app
cd notes-app
npm init -y
npm pkg set type=module
```

## Install seampact

```sh
npm install --save-dev @seampact/cli
```

This is the `seampact` command. The generators and the runtime of your server or client come with its guide, in [Your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/) for a server: [the package map](https://jubasse.github.io/seampact/concepts/packages/) lists them all.

Keep every `@seampact/*` package at the same version.

pnpm and Yarn take the same package names. pnpm holds back a package published in the last day: if it finds none, wait or add `minimumReleaseAgeExclude: ["@seampact/*"]` to `pnpm-workspace.yaml`. Yarn Plug'n'Play is not supported.

## Start the project

```sh
npx seampact init
```

You see `Created .gitignore.` among the lines. `init` writes:

- `seampact.config.yaml`, the config;
- `contract/api.yaml`, a small example contract;
- `contract/.seampact/schemas`, the schemas your editor reads to check the contract;
- `.seampact/` in `.gitignore`.

`npx seampact init --blank` writes the api header alone instead of the example.

Next: [your first API](https://jubasse.github.io/seampact/getting-started/your-first-api/)
