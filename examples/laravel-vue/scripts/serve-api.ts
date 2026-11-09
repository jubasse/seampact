// Serves the Laravel app for `pnpm dev:web`: PORT sets the port, 8000 by default (the one of .env.example).
import { startPhpServer } from "./php-server.js";

const DEFAULT_PORT = 8000;

const server = await startPhpServer(Number(process.env.PORT ?? DEFAULT_PORT));

console.log(`The api answers on ${server.baseUrl}`);
