import { copyFileSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { join } from "node:path"

const require = createRequire(
	import.meta.resolve("@earendil-works/pi-coding-agent")
)
const dist = join(import.meta.dir, "../dist")
mkdirSync(dist, { recursive: true })
copyFileSync(
	require.resolve("@silvia-odwyer/photon-node/photon_rs_bg.wasm"),
	join(dist, "photon_rs_bg.wasm")
)
