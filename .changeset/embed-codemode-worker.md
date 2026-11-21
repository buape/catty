---
"catty": patch
---

Fix codemode sandbox startup in standalone executables by preserving the embedded worker's source-relative path. Includes a compiled regression covering worker execution, tool callbacks, sandbox isolation, and execution from an empty workspace through an installation symlink without sidecar files.
