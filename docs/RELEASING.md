# Building installers and publishing releases

For maintainers. Users only need the [Quick start](QUICK_START.md).

## Build installers locally

Build each platform on that platform (the Windows installer needs Windows, or Wine on x64 Linux):

```bash
npm run dist:win     # Windows x64: NSIS Setup.exe and Portable.exe
npm run dist:mac     # macOS Intel + Apple Silicon: DMG and ZIP
npm run dist:linux   # Linux x64: AppImage and .deb
npm run release:check -- --artifacts   # check the installers, checksums and what was packaged
```

Output goes to `release/` with a `SHA256SUMS-<platform>.txt`. Installers stay around 100–125 MB because PyTorch is installed on first run instead of being bundled, which is also how the right GPU build gets selected. `release:check` fails if an installer is missing, is unexpectedly large, does not match its checksum, or if the packaged app lacks the UI, the icon or `python/worker.py`.

## Publish a release

`.github/workflows/release.yml` builds Windows, macOS and Linux on native GitHub runners, runs typecheck and tests on each, checks every installer, and publishes a GitHub Release with generated notes and a combined `SHA256SUMS.txt`.

1. Set the new version (updates `package.json` and `package-lock.json`):

   ```bash
   npm version 0.2.0 --no-git-tag-version
   ```

2. Commit it and merge to `main`.
3. Optional but recommended: in the Actions tab, run **Release → Run workflow** on `main`. It builds every installer and attaches them to the run without publishing anything.
4. Tag the commit on `main` and push the tag:

   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```

The workflow refuses a tag that differs from `package.json` (`v0.2.0` ↔ `0.2.0`). A tag with a suffix such as `v0.2.0-beta.1` publishes a pre-release.

## Unsigned builds

No signing certificates are configured: Windows builds are unsigned, and macOS builds are ad-hoc signed but not notarized, so users see the warnings described in the [Quick start](QUICK_START.md#2-install). To sign, add electron-builder's signing secrets to the repository and pass them to the package step of the release workflow:

- Windows: `CSC_LINK` and `CSC_KEY_PASSWORD` (or `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`).
- macOS: `CSC_LINK` and `CSC_KEY_PASSWORD` for a Developer ID certificate, plus `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` and `APPLE_TEAM_ID` for notarization. Remove `identity: "-"` and `hardenedRuntime: false` from `electron-builder.yml` when you do.

Never commit certificates or passwords.
