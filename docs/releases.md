# Releases

Catty releases are tag-driven.

## Required GitHub secret

Create this secret in the Catty repository:

```text
BUAPE_TAP_DISPATCH_TOKEN
```

It must be a PAT that can call `repository_dispatch` on `buape/tap`.

## Catty release flow

Update the version in package.json

Commit with `chore: release`

Push a semver tag:

```bash
git tag v0.1.0
git push && git push --tags
```

`.github/workflows/release.yml` will:

1. install dependencies with Bun
2. run typecheck
3. run Biome
4. build Bun standalone binaries for:
   - macOS arm64
   - macOS amd64
   - Linux amd64
5. package each binary and `photon_rs_bg.wasm` as a tarball
6. publish GitHub release assets
7. send `repository_dispatch` to `buape/tap` with the release tag

## Tap update flow

`buape/tap` owns formula generation.

Its `update-catty` workflow receives `catty_release`, downloads the Catty release tarballs, calculates SHA256s, writes `Formula/catty.rb`, runs `brew audit`, and commits with `buapebot`.

## Homebrew install

After the tap workflow updates the formula:

```bash
brew install buape/tap/catty
```

## Image-processing runtime asset

Pi's Photon image decoder loads `photon_rs_bg.wasm` at runtime. Bun does not
include that file just because the JavaScript decoder is bundled. Every binary
build copies the matching WASM from Pi's installed Photon dependency into `dist/`.
Each release archive must contain both `catty` and `photon_rs_bg.wasm`.

Install both files in the same directory. The Homebrew formula must install both
into `bin`; installing only `catty` breaks both attachment processing and image
reads, even for tiny images. Pi currently reports a missing decoder as an image
size-limit error, so shrinking the image will not help.

Run `bun test scripts/image-packaging.test.ts` before release. It forces the
compiled decoder's build-machine path to be unavailable, verifies the missing
asset fails, then verifies tiny and oversized PNGs through a Homebrew-style
symlink with the asset beside the real executable.

## Asset naming

The tap workflow expects this pattern:

```text
catty-VERSION-darwin-arm64.tar.gz
catty-VERSION-darwin-amd64.tar.gz
catty-VERSION-linux-amd64.tar.gz
```

For tag `v0.1.0`, `VERSION` is `0.1.0`.
