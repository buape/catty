import quickjsWasmPath from "quickjs-wasi/quickjs.wasm"
import { setEmbeddedQuickJSWasmPath } from "../node_modules/@earendil-works/pi-coding-agent/dist/config.js"

// Pi's standalone Bun runtime normally imports this asset from its own entrypoint.
// Catty uses pi-coding-agent as an SDK, so register the embedded asset ourselves.
setEmbeddedQuickJSWasmPath(quickjsWasmPath)
