import type { PluginRuntime } from "openclaw/plugin-sdk";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/compat";

const { setRuntime: setTeamilyRuntime, getRuntime: getTeamilyRuntime } =
  createPluginRuntimeStore<PluginRuntime>("Teamily runtime not initialized");
export { getTeamilyRuntime, setTeamilyRuntime };
