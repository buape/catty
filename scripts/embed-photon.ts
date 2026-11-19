import type { BunPlugin } from "bun"

// Photon locates its WASM with a computed fs path. Make that one asset an
// explicit import so Bun includes it in the executable's virtual filesystem.
export const embedPhoton: BunPlugin = {
	name: "embed-photon-wasm",
	setup(build) {
		build.onLoad(
			{ filter: /[/\\]photon-node[/\\]photon_rs\.js$/ },
			async (args) => {
				const source = await Bun.file(args.path).text()
				const lookup =
					"const path = require('path').join(__dirname, 'photon_rs_bg.wasm');"
				if (!source.includes(lookup)) {
					throw new Error(
						"Photon's WASM loader changed; update the embedded asset reference"
					)
				}
				return {
					contents: source.replace(
						lookup,
						"const path = require('./photon_rs_bg.wasm');"
					),
					loader: "js"
				}
			}
		)
	}
}
