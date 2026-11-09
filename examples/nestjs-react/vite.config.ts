import { defineConfig, loadEnv } from "vite";

const API_URL_VARIABLE = "VITE_API_URL";

export default defineConfig(({ mode }) => {
  // Without it the build would bake in an undefined base URL and the first call would fail in the browser.
  if (!loadEnv(mode, process.cwd(), "VITE_")[API_URL_VARIABLE])
    throw new Error(`${API_URL_VARIABLE} is not set: copy .env.example to .env, or export it.`);

  return {};
});
