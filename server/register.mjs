import { register } from "node:module";
import { loadEnvironment } from "../scripts/env.mjs";
loadEnvironment(process.cwd());
register("./server-only-loader.mjs", import.meta.url);
