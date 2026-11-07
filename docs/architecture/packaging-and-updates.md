# Packaging and updates

The target shell is Electron Builder with standalone per-platform artifacts:

| Platform    | Primary standalone artifact | Additional artifact           | Build command        |
| ----------- | --------------------------- | ----------------------------- | -------------------- |
| Windows x64 | Portable `.exe`             | ZIP                           | `npm run dist:win`   |
| Linux x64   | `.AppImage`                 | —                             | `npm run dist:linux` |
| macOS x64   | `.dmg` / `.zip`             | Apple Silicon `.dmg` / `.zip` | `npm run dist:mac`   |

CI builds on native Windows, Linux, and macOS runners; local development does not require model downloads. Every platform build emits a platform-specific `SHA256SUMS-<platform>.txt` file.

Release checklist:

1. Lock dependencies and produce an SBOM/license report.
2. Build each target on its native runner.
3. Run launch/import/mock/export smoke without network.
4. Sign artifacts with platform credentials where available; notarize macOS when configured.
5. Publish checksums and a release manifest.
6. Test update download, verification, install, and rollback path.

Unsigned binaries are suitable for local testing. Production distribution requires code-signing/notarization credentials and a native-runner smoke test for each artifact.

Updates must never replace the project data directory or model cache. Model catalogs are versioned independently from application updates. A failed update leaves the last known-good application available.
