# Security and privacy model

- Renderer uses context isolation, no Node integration, and a small preload API.
- Main validates project/job IDs, stems, filenames, and paths against the application data root. No shell interpolation is allowed.
- Worker subprocesses receive explicit argument arrays, a restricted environment, and project-owned read/write paths.
- Model and runtime downloads use HTTPS, expected size, checksum, and atomic activation. No remote script is executed as a model artifact.
- Source audio, filenames, local paths, and mix data never leave the machine in the default configuration.
- Telemetry is absent in the MVP and would be opt-in, documented, and redacted if added.
- Diagnostics redact home directories, usernames, tokens, and arbitrary source paths unless the user explicitly chooses a support bundle.
- Online source ingestion is disabled until terms-of-service, copyright, URL validation, and subprocess threat-model review are complete.

## Threats and controls

| Threat                     | Control                                                                                      |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| Malicious dropped path     | Main canonicalizes and checks file type/size before copy.                                    |
| Renderer IPC abuse         | Preload exposes named methods; main validates schema and ownership.                          |
| Path traversal in export   | Sanitize display names and resolve destination only through user-selected folder.            |
| Corrupt model artifact     | Checksum/size/version gate before activation.                                                |
| Worker compromise          | Narrow file scope, no renderer access, no shell, bounded time/memory where platform permits. |
| False success after crash  | Durable state machine and artifact validation gate.                                          |
| Sensitive diagnostics leak | Redaction plus explicit user action for export.                                              |
