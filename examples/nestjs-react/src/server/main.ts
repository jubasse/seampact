import { startServer } from "./start-server.js";

const port = Number(process.env.PORT ?? 3000);

await startServer(port);

console.log(`Notes api on http://localhost:${port}`);
