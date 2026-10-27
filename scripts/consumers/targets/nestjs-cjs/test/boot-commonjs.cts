// Boots a NestJS app on the CommonJS tree, as a CommonJS app does: the api's module with the consumer's hooks and
// one controller method per operation, then asks `GET /v1/health` and prints its status and body.
import "reflect-metadata";
import { Controller, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import * as Tasks from "../generated/server-cjs/tasks/index.js";

const HEALTH_PATH = "/v1/health";
const HEALTH_OPERATION = "health";

type MethodDecorator = (target: object, name: string, descriptor: PropertyDescriptor) => void;
type ParameterDecorator = (target: object, name: string, index: number) => void;

interface OperationDecorator {
  (): MethodDecorator;
  input(): ParameterDecorator;
}

const INPUT_PARAMETER_INDEX = 0;

// A generated operation decorator: a function that makes a method decorator and carries its `input` decorator.
function isOperationDecorator(value: unknown): value is OperationDecorator {
  return typeof value === "function" && "input" in value;
}

function operationDecorators(): Map<string, OperationDecorator> {
  const decorators = new Map<string, OperationDecorator>();

  for (const [name, value] of Object.entries(Tasks)) {
    if (isOperationDecorator(value)) decorators.set(name, value);
  }

  return decorators;
}

// A controller whose methods serve every operation: `health` answers, the others are never called here.
function everyOperationController(): new () => object {
  class EveryOperationController {}

  for (const [operation, decorator] of operationDecorators()) {
    const descriptor: PropertyDescriptor = {
      value: (_input: unknown) => {
        if (operation === HEALTH_OPERATION) return { status: 200, body: { status: "ok" } };

        throw new Error(`the CommonJS boot test does not serve '${operation}'`);
      },
      writable: true,
      configurable: true,
    };

    // As a compiled decorator does: the decorator may replace the descriptor's method, then the method is defined.
    decorator.input()(EveryOperationController.prototype, operation, INPUT_PARAMETER_INDEX);
    decorator()(EveryOperationController.prototype, operation, descriptor);
    Object.defineProperty(EveryOperationController.prototype, operation, descriptor);
  }

  Controller()(EveryOperationController);

  return EveryOperationController;
}

async function main(): Promise<void> {
  const { tasksHooks } = await import("../src/hooks.mjs");
  const controller = everyOperationController();
  const moduleClass = Tasks.SeampactModule.forRoot(tasksHooks());

  class CommonJsAppModule {}

  Module({ imports: [moduleClass], controllers: [controller] })(CommonJsAppModule);

  const app = await NestFactory.create(CommonJsAppModule, { logger: false });

  await app.listen(0, "127.0.0.1");

  const reply = await fetch(`${await app.getUrl()}${HEALTH_PATH}`);

  process.stdout.write(JSON.stringify({ status: reply.status, body: await reply.json() }));
  await app.close();
}

void main().catch((failure: unknown) => {
  process.stderr.write(`${String(failure)}\n`);
  process.exitCode = 1;
});
