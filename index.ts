import { defineChannelPluginEntry } from "openclaw/plugin-sdk/core";
import { teamilyPlugin } from "./src/channel.js";
import { setTeamilyRuntime } from "./src/runtime.js";

export default defineChannelPluginEntry({
  id: "teamily",
  name: "Teamily",
  description: "Teamily channel plugin",
  plugin: teamilyPlugin,
  setRuntime: setTeamilyRuntime,
});
