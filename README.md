# Pyde Design

The Pyde Design team's Figma tools in one plugin:

| Tool | What it does |
| --- | --- |
| **Handoff Pre Checklist** | A handoff checklist stored on a root frame or section. |
| **Design ReadMe** (*Tasarım Künyesi*) | Status, owners, Jira / Slack links and notes on a section, drawn as a yellow card inside it. |
| **Frame Note** (*Frame Notu*) | Designer notes drawn as a yellow card right below a frame. |
| **Image Optimizer** | Shrinks oversized images to the pixel size they are displayed at (2x / 3x / 4x). |

Run **Plugins → Pyde Design → Pyde Design** to get the list of tools, or pick a tool from the same menu to open the plugin straight on it. The **Edit Design ReadMe** and **Edit Frame Note** buttons in the right panel open it on that tool too.

The interface can be switched between English and Turkish in Settings (the gear in the top bar). That only changes the interface for you; the cards on the canvas stay in English.

## Install

1. Download this repo (Code → Download ZIP) and unzip it.
2. In Figma: Plugins → Development → Import plugin from manifest… → select `manifest.json`.

The old separate plugins (Handoff Pre Checklist, Design ReadMe, Frame Note, Image Optimizer) can be removed. Data they saved in files keeps working here: this plugin reads and writes the same keys. ReadMes and notes made with the old plugins get the new right-panel buttons the first time this plugin sees them.

## Updates

Only Pyde Design as a whole has a version; the tools inside it don't. On start the plugin checks `version.json` in this repo. Until that check passes, none of the tools can be used:

- If a newer version is out, it shows an "Update required" screen with a download link.
- If it can't check (offline, GitHub down), it stays blocked with a "Try again" button.
- While it stays open it re-checks every 5 minutes, and blocks as soon as it finds a newer version.

### Releasing a new version

1. Bump `VERSION` in `ui.html`.
2. Bump `version` in `version.json` to the same number.
3. Push to `main`.

`version.json`, `team.json` and `checklist.json` must stay in the repo root on `main` and the repo must be public, because the plugin reads them from `raw.githubusercontent.com`.

## Admin

Settings → **Admin** (the small link at the bottom) edits the checklist items and the team name list and publishes them to this repo, without editing JSON by hand:

- **Checklist**: edit the Turkish / English text of each item, reorder, remove (crossed out with **Restore** until you publish) and **+ Add item**. Ids are created automatically and existing ids never change. **Publish** first shows what will happen (items added / removed / reworded) and asks to confirm.
- **Team list**: type a name and press Enter to add it, ✕ to remove one.

Publishing commits straight to `main` (one commit per publish, so GitHub history shows every change). Others get it the next time they open the plugin; GitHub's raw files can take a few minutes to update. If the file changed on GitHub in the meantime, nothing is published: **Discard** loads the latest version.

It needs a GitHub **fine-grained personal access token** with access to this repository only and *Contents: Read and write*. The Admin screen explains how to create it. The token is kept only in this plugin's storage on the admin's computer, never in Figma files or the repo. **Disconnect** deletes it.

## Handoff Pre Checklist

Select a section, a root frame, or a frame placed directly inside a section. The state is saved in the file itself, so every designer sees the same status.

### Changing the items

The items live in **`checklist.json`** in this repo. Edit it and push to `main`; everyone gets the new list the next time they open the plugin, or within 5 minutes if it is open (no version bump needed).

```json
[
  { "id": "component-structure", "en": "Component structure preserved", "tr": "Component yapısı korundu" }
]
```

- `id` is what is stored in the file. **Never change an existing `id`**, or that item's existing checks are lost. The texts can be reworded freely; `tr` falls back to `en` when missing.
- Adding an item makes it unchecked everywhere, so a frame that was complete becomes incomplete.
- Removing an item is safe: its old checks stay in the file but don't count, and come back if the item is added again.
- `legacy` is only for the original items (their text key from before ids existed); new items don't need it.

If `checklist.json` can't be loaded or isn't valid, the plugin uses the list built into `ui.html`. Settings shows which one is in use. Keep that built-in list (`BUILT_IN` in `ui.html`) roughly in sync when you release a new version.

## Design ReadMe

1. Select a section and open Design ReadMe. A ReadMe can only be added to a section, not to a frame.
2. Fill in the form and click **Add Design ReadMe**.
   - The card is placed inside the section, in its top-left corner (96 px from the left and top). The existing content moves down to start 96 px below the card, and the section grows to fit. When the card later gets taller or shorter, the content below it moves with it.
3. To edit later, select the section or the card and click **Edit Design ReadMe** in the right panel.

Don't edit the card's text by hand — it is redrawn from the form on every save. The card is a normal Figma frame made of plain text layers, so Figma MCP and Dev Mode read it like any other part of the section.

The section name shows its status after an em dash, updated on every save: `Checkout Flow — 🚧 Work in progress`, `— 👀 In review`, `— ✅ Ready for development`. Removing the ReadMe removes the suffix.

The **Overview** tab lists every ReadMe in the file. The current page is rescanned each time you open the tab; other pages show their last known state. **Scan all pages** refreshes everything.

### Owner suggestions

Any name can be typed into any owner field. Figma only lets plugins see the people who have the file open right now, so suggestions are combined from:

1. **`team.json` in this repo**: a plain list of names (`["Name Surname", …]`). Edit it and push to `main`; everyone gets the new list the next time they open the plugin (no version bump needed). The repo is public, so it should only contain names.
2. Every owner saved in a ReadMe in the current file.
3. Names you typed before, in any file (stored only on your machine).
4. People who currently have the file open, and you.

## Frame Note

1. Select a frame and open Frame Note. Selecting a layer inside a frame works too: the note belongs to the top-level frame (the one directly in a section or on the page). Frames that aren't in a section get a note too, but the plugin warns about it: developers (and Claude) usually read a whole section, so frames are best kept in one.
2. Write the note. **+ Add note** adds another paragraph. Click **Add note** (or ⌘/Ctrl + Enter).
3. To edit later, select the frame or its card and click **Edit Frame Note** in the right panel.

The card appears right below the frame, exactly as wide as the frame, in the same section (or on the page). Each paragraph shows who wrote it and when. Its layer name says which frame it belongs to: `📝 Note → Login (12:345)`.

- Select several frames to add the same paragraph to all of them.
- While the plugin is open (on any tool), a card follows its frame when the frame is moved, resized or renamed. Anything that drifted while the plugin was closed is fixed the next time it is opened on that page.
- Duplicating a frame duplicates its note. Deleting a frame leaves its card behind, renamed `📝 Note (frame deleted) → …`; delete it from the **Overview** tab or by selecting it.
- Don't delete a card to remove a note — use **Remove** in the plugin.

## Image Optimizer

1. **Save a version first** (File → Save to version history).
2. Pick a **scope**: Selection, This page or Whole file. Selecting a frame or section switches the scope to Selection automatically.
3. Pick a **target resolution**. 3x is recommended; 2x can look blurry on 3x phone screens.
4. Pick a **file size** threshold. Only images at least that heavy, and at least 10% bigger than needed, are listed.
5. Click **Scan**, untick what you want to keep and click **Optimize**. One ⌘Z / Ctrl+Z undoes the whole run.

Only the pixel size changes: PNGs stay PNG (lossless), JPEGs stay JPEG (saved again at quality 92). Images that wouldn't get smaller are left alone, GIFs are skipped, and images never leave your computer. Images inside a published library component can't be changed from another file.

## For developers using Claude Code + Figma MCP

Add this to your project's `CLAUDE.md` so Claude always reads the cards:

```md
## Figma designs
Before implementing a Figma section, look for a layer named "📋 Design ReadMe — …" inside it.
If you were given a frame inside a section, read the parent section's Design ReadMe too.
It contains the status, owners, Jira / Slack links and the designer's notes.
Treat the notes as requirements.
- If the status is not "Ready for development", say so before implementing.

## Figma frame notes
Designers leave notes on individual frames, in a layer named "📝 Note → <frame name> (<frame node id>)",
placed right below the frame in the same section (or on the page, if the frame isn't in a section).
- Whenever you are given a Figma frame, call get_metadata on the section (or page) it sits in and look for the
  "📝 Note → … (<node id>)" layer with that frame's node id (the id in a Figma URL uses "-" instead of ":",
  e.g. node-id=12-345 is 12:345). Read it with get_design_context.
- Treat the notes as requirements for that frame. If a note contradicts the design, ask before implementing.
- Layers named "📝 Note (frame deleted) → …" are leftovers; ignore them.
```
