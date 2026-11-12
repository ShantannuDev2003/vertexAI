# Terminal and Explorer File Synchronization

## Overview

The terminal service runs commands inside a temporary workspace:

```text
os.tmpdir()/vertex-ai/<projectId>
```

The Explorer does not read that temporary workspace directly. Explorer reads
the project tree from the file service and renders the tree held in
`ProjectPage` state.

Because these are two separate locations, synchronization is required in both
directions:

```text
Editor/File service  ->  terminal workspace
Terminal workspace   ->  file service  ->  Explorer state
```

The fix keeps the existing terminal, Socket.IO, file-service routes, and
Explorer components. It adds only the synchronization logic needed to keep the
two representations consistent.

## Issues that were resolved

### 1. Project-root path mismatch

The file service returns a tree containing the project root folder. The
terminal workspace stores the root folder's children directly:

```text
File service:
project-root/
  notes.txt

Terminal workspace:
<workspace>/notes.txt
```

The original reverse-sync code used `path.dirname("notes.txt")`, which returns
`"."`. The synchronization map represents the workspace root as an empty
relative path, `""`. Therefore, root-level terminal files could not find their
database parent folder and were skipped.

A small `resolveParentPath` helper now maps both `"."` and an empty path to
`""`. Nested paths continue to resolve normally:

```text
notes.txt       -> ""
src/app.js      -> "src"
```

### 2. Stale files after terminal initialization

The workspace directory persists in the operating-system temporary directory.
Files from an earlier terminal session could remain there even after they had
been removed from the file service.

Initialization now:

1. Reads the latest file-service tree.
2. Converts it to workspace-relative paths.
3. Removes non-ignored local entries that are not in the latest tree.
4. Writes the latest file-service contents into the workspace.

This prevents stale files from being treated as new terminal-created files on
the next restart.

### 3. Rename races and duplicate records

A filesystem rename can produce multiple `fs.watch` events. Treating a rename
as two unrelated operations can cause this sequence:

```text
create new database record
delete old database record
```

If synchronization runs between those events, Explorer can temporarily show
duplicates or the wrong record can be deleted.

When a new disk file has:

- the same parent folder as a missing database file,
- matching content, and
- no existing database entry at the new path,

the terminal service treats it as a rename and sends one existing file record
to the file service with an updated `name` and `content`. This preserves the
database ID and avoids creating a duplicate record.

The watcher debounce was also increased to `750ms`, allowing rapid filesystem
operations to settle before a reconciliation begins.

### 4. Unsafe deletion caused by path mismatches

Terminal-to-file-service synchronization must not soft-delete a database
entry merely because a path was temporarily absent during a filesystem event.

The service keeps a verified `databaseSnapshot` of paths that existed in the
workspace's previous synchronized state. A missing database entry is deleted
only when:

1. It is absent from the current verified disk scan.
2. It was present in the previous verified database snapshot.

Ignored directories are excluded from all synchronization scans:

```text
node_modules
.git
dist
build
```

## Runtime synchronization model

### File service to terminal workspace

`syncProject` runs when a terminal session initializes.

It retrieves `/tree/:projectId`, removes stale non-ignored workspace entries,
and writes the current tree into the temporary workspace.

During an active session, a lightweight interval checks the file-service tree
for editor-side changes. It updates changed file contents, creates missing
folders/files, and removes workspace entries that were deleted in the file
service.

This path is guarded while a terminal filesystem reconciliation is active, so
an editor poll cannot overwrite a terminal change that is still being
processed.

### Terminal workspace to file service

The recursive filesystem watcher observes the terminal workspace. It ignores
the configured directories and debounces events.

After the debounce period, `synchronizeWorkspace`:

1. Reads the current file-service tree.
2. Scans the current workspace into normalized relative paths.
3. Creates missing folders through `/create-folder`.
4. Detects renames and updates existing files through `/update/:id`.
5. Creates genuinely new files through `/create-file`.
6. Updates changed file content through `/update/:id`.
7. Deletes verified database entries through `DELETE /:id` only when their
   previous synchronized path is absent from disk.
8. Retrieves the final tree and updates `databaseSnapshot`.

The final tree is fetched after the write operations complete. Only then does
the terminal service emit:

```text
terminal:files-changed
```

## Explorer refresh flow

The Explorer tree is stored in `ProjectPage` state. Updating the file service
alone is not enough to update the visible Explorer; the frontend must request
the tree again.

The refresh flow is:

```text
terminal filesystem event
  -> synchronizeWorkspace()
  -> file-service create/update/delete requests
  -> final file-service tree confirmed
  -> terminal:files-changed Socket.IO event
  -> Terminal.jsx receives event
  -> ProjectPage.loadTree()
  -> Explorer receives new tree prop
```

This refreshes Explorer without a page reload or clicking the Explorer refresh
button.

## Files changed

### `backend/services/terminal/index.js`

This is the main implementation file. It contains:

- workspace tree normalization,
- root-aware parent path resolution,
- stale workspace cleanup,
- filesystem scanning,
- database snapshot tracking,
- terminal-to-file-service reconciliation,
- editor/file-service-to-workspace polling,
- debounced filesystem watching,
- the `terminal:files-changed` notification.

The existing shell process, terminal data events, terminal resize event,
health route, and Socket.IO initialization behavior remain in place.

### `frontend/src/components/Terminal.jsx`

Listens for the terminal service's `terminal:files-changed` event and invokes
the callback supplied by the page.

### `frontend/src/components/BottomPanel.jsx`

Passes the file-change callback from the project page down to the terminal
component.

### `frontend/src/pages/ProjectPage.jsx`

Passes the existing `loadTree` function into the terminal panel. `loadTree`
already calls the existing file-service tree API and updates the page's tree
state. It is memoized with `useCallback` so the terminal Socket.IO connection
does not restart after every Explorer refresh.

The file-service API and `AiChat.jsx` were not changed.

## Example operation flows

### Create

```powershell
echo test > notes.txt
```

1. The shell creates `notes.txt` in the temporary workspace.
2. The watcher debounces the event.
3. The terminal service finds the project root folder using the normalized
   empty parent path.
4. It calls `/create-file`.
5. It confirms the resulting tree.
6. It emits `terminal:files-changed`.
7. Explorer reloads the tree and displays `notes.txt`.

### Rename

```powershell
mv notes.txt renamed.txt
```

1. The watcher waits for the rename events to settle.
2. The old path is absent and the new path is present.
3. Matching parent and content identify the operation as a rename.
4. The existing database record is updated using `/update/:id` with the new
   name.
5. No duplicate database record is created.
6. Explorer reloads after the final tree is confirmed.

### Delete

```powershell
rm renamed.txt
```

1. The watcher detects the missing disk path.
2. The path is checked against the previous verified snapshot.
3. The matching file-service entry is soft-deleted through `DELETE /:id`.
4. The final tree excludes the entry.
5. Explorer reloads and removes the file without a page refresh.

## Manual verification checklist

1. Open a project with Explorer and Terminal visible.
2. Run:

   ```powershell
   echo test > sync-test.txt
   ```

   Confirm that one `sync-test.txt` appears in Explorer without clicking
   Refresh.

3. Run:

   ```powershell
   mv sync-test.txt renamed-test.txt
   ```

   Confirm that Explorer shows only `renamed-test.txt`.

4. Run:

   ```powershell
   rm renamed-test.txt
   ```

   Confirm that Explorer removes the file automatically.

5. Repeat create, rename, and delete several times. Confirm that:

   - duplicate entries do not appear,
   - renamed entries keep one Explorer item,
   - deleted entries do not return after a refresh,
   - ignored directories are not synchronized.

6. Restart the terminal session and confirm that the workspace matches the
   current file-service tree with no stale entries.


Other edge cases worth knowing
Scenario	Potential behavior
Large project with many files	Repeated full-tree API requests and recursive scans can increase latency and service load.
Binary files	The synchronization code reads files as UTF-8 text. Images, archives, and other binary assets may become corrupted if written back through this path.
Case-only rename on Windows	Case-insensitive filesystem behavior can make the old and new paths difficult to distinguish.
File-service outage	Terminal commands can continue locally, but synchronization may fail until recovery is triggered.
Unexpected filesystem watcher closure	The error is logged, but the code does not explicitly restart the watcher.
Empty folders	The current implementation does scan and create directories, but empty-folder deletion and rename cases deserve separate tests.
Very large files	Reading complete files into memory and sending them through JSON requests may become expensive.



Complete edge-case checklist: Terminal ↔ Explorer synchronization
Based on your backend/services/terminal/index.js, Terminal.jsx, BottomPanel.jsx, and ProjectPage.jsx code, here is a consolidated checklist of edge cases to consider.

Legend: 🔴 High priority — possible data loss or corruption; 🟠 Medium priority — consistency, reliability, or usability; 🟡 Lower priority — compatibility or performance.

These are potential failure scenarios, not claims that every issue currently occurs. Your six basic synchronization tests have already passed.
1. File synchronization and data integrity
Edge-case test tracker
0 of 130 checks marked complete

0%



Mark all testedReset
A. Create, edit, rename and delete0/15 testedHigh
[ ] Create a file at the workspace root in the terminal.
[ ] Create a file inside a nested folder in the terminal.
[ ] Create an empty file.
[ ] Create a file whose name contains spaces or Unicode characters.
[ ] Edit a file in the editor while the terminal is open.
[ ] Edit a file in the terminal while the editor has unsaved changes.
[ ] Rename a file without changing its content.
[ ] Rename a file and change its content immediately.
[ ] Rename a file to a name that already exists.
[ ] Delete a file from the terminal.
[ ] Delete a file from Explorer while the terminal is open.
[ ] Delete and recreate a file with the same name quickly.
[ ] Create and delete a file before the watcher debounce completes.
[ ] Perform multiple rapid edits to the same file.
[ ] Copy a file with identical content to another path.


B. Data-loss and synchronization races0/14 testedHigh
[ ] Restart the terminal immediately after creating a file.
[ ] Close the terminal before the 750 ms watcher debounce finishes.
[ ] Disconnect the socket while a file change is being synchronized.
[ ] Edit the same file from editor and terminal almost simultaneously.
[ ] Have an editor poll occur after a terminal write but before its watcher event.
[ ] Trigger a second synchronization while the first is still running.
[ ] Delete a file while an update request for that file is in flight.
[ ] Rename a file while another synchronization is scanning the tree.
[ ] Cause one API request in a multi-file sync to fail after earlier requests succeed.
[ ] Make the file service temporarily unavailable during synchronization.
[ ] Restore the file service after a failed synchronization without making another edit.
[ ] Verify a stale workspace file cannot cause a valid database entry to be deleted.
[ ] Verify an incomplete filesystem scan cannot trigger mass database deletions.
[ ] Verify an older snapshot cannot overwrite newer file contents.


C. Folder structure0/13 testedHigh
D. Rename detection and record identity0/8 testedHigh
E. Multiple sessions and project isolation0/9 testedHigh
F. Startup, restart and cleanup0/10 testedHigh
G. File types and filesystem compatibility0/11 testedMedium
H. Watcher and event delivery0/10 testedMedium
I. File-service API and database behavior0/12 testedHigh
J. Frontend, socket and React lifecycle0/11 testedMedium
K. Security and command execution0/8 testedHigh
[ ] Attempt a path traversal filename such as ../outside.txt.
[ ] Attempt to access another project's workspace using a modified project ID.
[ ] Attempt to initialize a terminal with another user's project ID.
[ ] Verify shell commands cannot escape the intended workspace if isolation is required.
[ ] Test symlinks pointing outside the workspace.
[ ] Verify request identity cannot be forged just by supplying a userId from the client.
[ ] Test shell process termination and resource cleanup.
[ ] Test runaway processes, excessive output and memory usage.


L. Performance and scale0/9 testedMedium
Copy checklist as text
2. The five most important tests to run first
If you don't want to test everything at once, start with these:
1. Rapid restart: create sync-test.txt in the terminal and restart the terminal immediately. Check whether the file remains in Explorer and on disk.
2. Conflicting edits: change the same file from the editor and terminal at nearly the same time. Confirm the final content is consistent and neither version disappears unexpectedly.
3. Two sessions: open the same project in two tabs and create, edit, and delete files from each terminal.
4. Rename a folder: rename a folder containing several files. Check Explorer for duplicates, missing children, and unexpected changes to file identities.
5. API failure recovery: temporarily make the file service unavailable, perform a terminal file change, restore the service, and check whether synchronization recovers without another manual edit.