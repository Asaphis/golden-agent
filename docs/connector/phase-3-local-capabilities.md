# Phase 3 local capabilities

Phase 3 extends the connector brain beyond basic filesystem and terminal access. The connector now supports controlled process start and stop, project build and test commands, and artifact metadata collection.

Process start requires `process.manage` and the executable must be present in the local terminal allowlist. The connector tracks processes it starts and only permits `process.stop` for those managed process IDs. Child processes use the restricted environment established in Phase 2.

`testing.run` requires `testing.execute` and runs the project test command in an approved workspace. `building.run` requires `building.execute` and runs the project build command in an approved workspace. Both operations have bounded timeouts and output buffers.

`artifact.collect` requires `filesystem.read`, validates the approved root canonically, skips symbolic links, and returns bounded metadata for files including path, size, and modification time. File contents are not uploaded by this operation.

The Phase 3 connector-core integration test covers process start/stop and artifact collection. Existing pairing, service, security, and task lifecycle suites continue to pass.
