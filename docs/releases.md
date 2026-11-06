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
5. package each self-contained binary as a tarball
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

## Single-executable image processing

Every release installs **only the Catty executable**. No separately installed
WASM files, helper binaries, or runtime asset extraction are required.

Pi's Photon decoder normally opens `photon_rs_bg.wasm` using a computed disk
path, which Bun cannot discover as an asset dependency. `scripts/embed-photon.ts`
makes that lookup an explicit WASM import at build time. Bun's file loader embeds
the matching dependency asset into the executable's virtual filesystem; Photon's
existing decoder reads it directly there. No runtime filesystem interception or
writes are added. The build fails if Photon's loader changes rather than silently
shipping a broken decoder.

Use `bun run build:binary` or the `release:*` scripts so the embedding plugin is
applied. Release archives and Homebrew still contain/install only `catty`.

Run `bun test scripts/image-packaging.test.ts` before release. It makes the
original build-machine lookup unavailable, confirms the old build fails, then
checks tiny and oversized PNGs through a Homebrew-style executable symlink from
an empty working directory. The test also verifies no files are extracted.

## Asset naming

The tap workflow expects this pattern:

```text
catty-VERSION-darwin-arm64.tar.gz
catty-VERSION-darwin-amd64.tar.gz
catty-VERSION-linux-amd64.tar.gz
```

For tag `v0.1.0`, `VERSION` is `0.1.0`.
