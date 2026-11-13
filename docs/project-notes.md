# Project Notes

Notes are local project documents, independent of AI chats and scientific runs.
Open **Notes** in the project navigation, or choose **Take notes beside** to pair
Notes with Canvas or a document. Closing a tab preserves its drafts and history.

The Markdown source editor supports search, undo/redo and Cmd/Ctrl-S. Preview
renders Markdown and formulas without executing scripts or raw HTML. Export `.md`
downloads the current text, including unsaved changes. A note is limited to 1 MiB
of UTF-8; store images as project artifacts instead of inline base64 data.

Typing saves a working draft to IndexedDB after 500 ms idle (at most two seconds
while typing) and to the local core after one second idle (at most five seconds).
These are drafts: **Save** creates an immutable revision with a parent, checksum
and author. Each editor has a separate draft. Browser recovery retains both the
draft and its last known checkpoint so an already opened note can be recovered
while the core is unavailable. The web application itself must still be available;
this does not install an offline web app.

Status distinguishes browser recovery, an app draft, offline operation and failed
saves. A storage failure never clears the editor. Export a copy if browser storage
or disk is full. A concurrent Save reports a conflict and keeps your text. Compare
the saved revision, save a separate copy, or preserve your draft as a copy before
opening the latest revision. Drafts and immutable revisions are not pruned
automatically, including when an older local archive is restored.

**Attach to AI** pins an immutable snapshot, or the selected source text, to the
conversation. **Save and attach** checkpoints dirty text first. Snapshots are
limited to 32 KiB and retain their source revision and SHA-256. Later edits do not
change a sent citation. Remove the context chip to stop using it in subsequent
messages; sent messages keep their original context.

AI can propose independent exact-text hunks. Open **Refresh AI proposals** in
Notes, review the before/after and reason, and accept or reject each hunk. Accepting
creates a user-authored revision with AI provenance. Further hunks remain
reviewable against previous acceptances. An external edit, steering or stopped AI
run invalidates the proposal. Save or compare a dirty editor before accepting.
Notes acceptance does not change scientific configuration or launch a calculation.

Local `.phynite` archives include Notes, revisions and drafts. Imported proposals
are stale and cannot grant new authority. Cloud Sync excludes Notes in v1.
Set `PHYNITE_PROJECT_NOTES=0` in the core environment to disable the Notes API
independently of connected files and Team orchestration.
