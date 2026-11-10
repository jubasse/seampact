# Install

Install the `seampact` command from npm and start a project. This page is for a Node.js app. For Spring Boot, Laravel, Symfony, API Platform or Python, go to [install in other ecosystems](install-other-ecosystems.md); [commands per stack](../features/commands-per-stack.md) shows how each runs the commands.

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

This is the `seampact` command. The generators and the runtime of your server or client come with its guide, in [Your first API](your-first-api.md) for a server: [the package map](../concepts/packages.md) lists them all.

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

Next: [your first API](your-first-api.md)
