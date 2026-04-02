import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { emptyPluginConfigSchema } from "openclaw/plugin-sdk";
import { teamilyPlugin } from "./src/channel.js";
import { setTeamilyRuntime } from "./src/runtime.js";

const MIN_OPENCLAW_VERSION = "2026.3.8";

function meetsMinVersion(current: string, minimum: string): boolean {
  const parse = (v: string) => v.split(".").map(Number);
  const cur = parse(current);
  const min = parse(minimum);
  for (let i = 0; i < min.length; i++) {
    if ((cur[i] ?? 0) > (min[i] ?? 0)) return true;
    if ((cur[i] ?? 0) < (min[i] ?? 0)) return false;
  }
  return true;
}

const plugin = {
  id: "teamily",
  name: "Teamily",
  description: "Teamily channel plugin",
  configSchema: emptyPluginConfigSchema(),
  register(api: OpenClawPluginApi) {
    const version = api.runtime.version;
    if (version && version !== "unknown" && !meetsMinVersion(version, MIN_OPENCLAW_VERSION)) {
      throw new Error(
        `Teamily plugin requires OpenClaw >= ${MIN_OPENCLAW_VERSION}, but current version is ${version}. Please upgrade: npm install -g openclaw@latest`,
      );
    }
    setTeamilyRuntime(api.runtime);
    api.registerChannel({ plugin: teamilyPlugin });
  },
};

export default plugin;
