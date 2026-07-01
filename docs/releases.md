# Releases

Catty releases are tag-driven.

## Required GitHub secret

Create this secret in the Catty repository:

```text
BUAPE_TAP_DISPATCH_TOKEN
```

It must be a PAT that can call `repository_dispatch` on `buape/tap`.

## Catty release flow

Push a semver tag:

```bash
git tag v0.1.0
git push origin v0.1.0
```

`.github/workflows/release.yml` will:

1. install dependencies with Bun
2. run typecheck
3. run Biome
4. build Bun standalone binaries for:
   - macOS arm64
   - macOS amd64
   - Linux amd64
5. package each binary as a tarball
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

## Asset naming

The tap workflow expects this pattern:

```text
catty-VERSION-darwin-arm64.tar.gz
catty-VERSION-darwin-amd64.tar.gz
catty-VERSION-linux-amd64.tar.gz
```

For tag `v0.1.0`, `VERSION` is `0.1.0`.
