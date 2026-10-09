# Pyde Design

The Pyde Design team's Figma tools in one plugin:

| Tool | What it does |
| --- | --- |
| **Handoff Pre Checklist** | A handoff checklist stored on a root frame or section. |
| **Design ReadMe** (*Tasarım Künyesi*) | Status, owners, Jira / Slack links and notes on a section, drawn as a yellow card inside it. |
| **Frame Note** (*Frame Notu*) | Designer notes drawn as a yellow card right below a frame. |
| **Title Maker** (*Başlık Ekleyici*) | Adds a title bar above selected frames, pushes the content below down and lines the frames up. |
| **Image Optimizer** | Shrinks oversized images to the pixel size they are displayed at (2x / 3x / 4x). |

Run **Plugins → Pyde Design → Pyde Design** to get the list of tools, or pick a tool from the same menu to open the plugin straight on it. The **Edit Design ReadMe** and **Edit Frame Note** buttons in the right panel open it on that tool too.

Figma runs only one plugin or widget at a time: clicking into a widget (to copy its text, for example) closes this plugin. Unsaved Frame Note and Design ReadMe edits are kept as a draft on your computer while you type, so when you open the plugin again on the same frame or section, they come back with a "restored" notice. Save them, or drop them with **Drop these changes**. Drafts older than a week are removed.

It's meant to stay open while you work: the button next to the gear in the top bar shrinks it to just the top bar (200 × 52), and clicking it (or the logo) brings it back. Frame Note keeps its cards following their frames in the background either way, and an update still opens it up.

The plugin and the cards it draws use DM Sans. The interface can be switched between English and Turkish in Settings (the gear in the top bar). That only changes the interface for you; the cards on the canvas stay in English.

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

It needs a GitHub **fine-grained personal access token** with access to this repository only and *Contents: Read and write*. To create one: GitHub → Settings → Developer settings → Fine-grained tokens → Generate new token; *Repository access*: only this repository; *Permissions*: Contents → Read and write. Paste it into the Admin screen's key field. The token is kept only in this plugin's storage on the admin's computer, never in Figma files or the repo. **Disconnect** deletes it.

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
   - The card is placed inside the section, in its top-left corner (100 px from the left and top, like Figma's own *Resize to fit* for sections). The existing content moves down to start 96 px below the card, and the section grows to fit. When the card later gets taller or shorter, the content below it moves with it.
3. To edit later, select the section or the card and click **Edit Design ReadMe** in the right panel.

Don't edit the card's text by hand — it is redrawn from the form on every save. The card is a normal Figma frame made of plain text layers, so Figma MCP and Dev Mode read it like any other part of the section.

The section name shows its status after an em dash, updated on every save: `Checkout Flow — 🚧 Work in progress`, `— 👀 In review`, `— ✅ Ready for development`. Removing the ReadMe removes the suffix.

**Tidy up section** (under the selected section) is the same as in Title Maker (see below). It works on any section, with or without a ReadMe.

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
- **A note exists only while it has a card.** Deleting a card removes the note (undo brings both back). Duplicating a frame together with its card (⌘D or Alt-drag both) gives the copy its own note; duplicating the frame alone gives a frame without a note.
- **Copying a note to another frame**: put a copy of the card right below that frame (24 px below it, aligned to its left edge, e.g. Alt-drag it sideways to the next frame of the same height). The card becomes that frame's note, with what the card shows. A copy left anywhere else is marked as broken, and **Fix** suggests the frame right above it.
- **Broken notes**: a card that no frame owns — its frame was deleted, it was copied on its own, or its frame was moved inside another layer — is never deleted by the plugin. When the plugin opens, it renames it `📝 Note (broken: …) → …`, covers it with a red warning and lists it under **Broken notes** in the **Overview** tab, where it can be fixed or deleted. Undoing a frame's deletion brings its card back to normal.
- **Fixing a broken note**: select the card and click **Fix**. If a frame sits right above the card (its bottom edge at most 100 px above it, overlapping it horizontally), it is suggested; otherwise, or to pick another one, select a frame on the canvas, then **Attach note**. The note keeps its paragraphs, authors and dates. If that frame already has a note, the paragraphs are added at the end (identical ones are skipped) and the broken card goes away. Fixing a copied card leaves the original note untouched.
- **Text edited on the card**: if someone changes a paragraph right on the card, the plugin takes that text into the note the next time it opens on that page (or right away while it is open). The card isn't redrawn for it, so the person typing isn't interrupted.
- To remove a note, delete its card or use **Remove** in the plugin.

## Title Maker

**Adding a title**: select one or more frames (in the same section, or all directly on the page), type the title and click **Add title** (or press Enter). The title goes 48 px above the top frame and is as wide as the frames; nothing else moves. If it covers something there, the plugin says so — **Tidy up section** makes room.

- **Line up the frames** (on by default, remembered per person): rows follow how the frames are placed now (frames that overlap vertically are one row). The rows start 48 px below the title, frames are 48 px apart and aligned at the top. A frame with a Frame Note counts together with its card, so notes never land on the next row.

**A selected title** (or its text) is recognised: **Update style** brings an older or hand-made title to the current style (keeping its text), and **Line up its frames** lines up the frames below it and fits the title to them. A frame belongs to the closest title above it that it overlaps horizontally, so copied titles work too.

**Old titles**: titles made by hand before this plugin (by different designers, in different styles) can be turned into plugin titles. The **Overview** tab lists the titles on the current page and, under **Old titles**, the layers that look like one in the selected section (or on the current page): a frame — or a group holding just one frame — with a single text in it, sitting directly in a section or on the page, filled, flat and wide (24–160 px high, at least 3.5× as wide as high), with screens right below it. Coloured bars without text are skipped. They all come ticked; untick the ones that aren't titles and click **Convert**. A converted title gets the current style and keeps its text and width; a title that was alone in a group comes out of it. Selecting a single such layer also offers **Convert to title**, even when it doesn't match the shape rules. Clicking a row selects that layer.

**Tidy up section** (also on the Design ReadMe screen) rearranges the section the selection is in:

- The Design ReadMe card goes to the top-left corner, 100 px from the edges.
- The screen groups start 100 px below the ReadMe (or 100 px from the top). A group is a title with its frames, or a frame on its own. Groups are laid out in rows that follow how they are placed now, 48 px apart both ways.
- Inside a group, the frames are lined up 48 px below the title, 48 px apart, and the title is as wide as them.
- A frame moves with its Frame Note card, and loose layers (text, arrows, shapes…) move with the frame they sit closest to. Nested sections, groups and component sets move as one piece.
- The section is sized to 100 px around its content (like Figma's own *Resize to fit*); the section itself stays in place. One ⌘Z / Ctrl+Z undoes it all.

The title is a frame named `🏷 Title` with one text layer: DM Sans Semi Bold 34 / 36 in white on a `#7B7D83` → `#5C5E66` gradient (top to bottom), with a 1 px white stroke fading from 40% at the top to 0 at the bottom and 8 px corners. Edit its text on the canvas like any other text; copying a title is fine.

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
- Layers named "📝 Note (broken: …) → …" (or the older "📝 Note (frame deleted) → …") are leftovers; ignore them.

## Figma titles
Layers named "🏷 Title" are headings for the frames right below them (their text is the name of that
group of screens). They are labels, not UI to implement.
```
