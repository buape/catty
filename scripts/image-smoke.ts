import { deflateSync } from "node:zlib"
import { resizeImage } from "../node_modules/@earendil-works/pi-coding-agent/dist/utils/image-resize.js"

// Generate valid PNGs without loading Photon first. Even tiny images need its
// decoder; the large case also exercises the actual resizing/encoding path.
for (const width of [16, 2100]) {
	const chunks = [Buffer.from("89504e470d0a1a0a", "hex")]
	const header = Buffer.alloc(13)
	header.writeUInt32BE(width, 0)
	header.writeUInt32BE(16, 4)
	header[8] = 8
	header[9] = 2
	const pixels = Buffer.alloc((width * 3 + 1) * 16)
	for (let y = 0; y < 16; y++) {
		for (let x = 0; x < width; x++)
			pixels[y * (width * 3 + 1) + 1 + x * 3] = 255
	}
	for (const [type, data] of [
		["IHDR", header],
		["IDAT", deflateSync(pixels)],
		["IEND", Buffer.alloc(0)]
	] as const) {
		const body = Buffer.concat([Buffer.from(type), data])
		const chunk = Buffer.alloc(body.length + 8)
		chunk.writeUInt32BE(data.length, 0)
		body.copy(chunk, 4)
		chunk.writeUInt32BE(Bun.hash.crc32(body), body.length + 4)
		chunks.push(chunk)
	}
	const result = await resizeImage(Buffer.concat(chunks), "image/png")
	if (!result || result.width > 2000 || result.originalWidth !== width) {
		throw new Error(`Image processing failed for ${width}px PNG`)
	}
	if (result.wasResized !== width > 2000) {
		throw new Error(`Unexpected resize result for ${width}px PNG`)
	}
}
console.log("Image smoke test passed: tiny image and oversized image")
