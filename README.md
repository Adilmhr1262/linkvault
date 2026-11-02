# LinkVault — Personal Bookmark Organizer

Save, organize, search, and manage your favorite website links in one place. No account, no server, no tracking. Your data stays in IndexedDB in your own browser.

## Features

- Dashboard: saved count, favorites, collections, recently added, recently opened
- All Bookmarks: instant search by title, URL, description, or collection; collection filter; favorites-only filter; sorting by newest, oldest, alphabetical, or recently opened
- Collections: create, rename, and delete collections; deleting a collection keeps its bookmarks under No collection
- Bookmarks: add, edit, delete (with confirmation), favorite, and open in a new tab; hostname and favicon shown for each link
- Duplicate detection: saving a URL that is already saved shows a warning and requires a second save to confirm
- Recently opened: opening a bookmark records when it was last launched
- Import and export: download a JSON backup and restore it; the whole file is validated first, and a failed import never changes your data
- Dark and light mode, saved as a preference
- Responsive layout for mobile, tablet, and desktop, with keyboard navigation and visible focus

## Setup

No build step and no dependencies. Serve the folder with any static server, for example:

```sh
python3 -m http.server 8000
```

Then open http://localhost:8000/

Opening the file directly also works in most browsers, but a local server is the reliable way to test IndexedDB and favicons.

## Deployment

This is a static site. Publish the contents of this folder (index.html, style.css, app.js) to GitHub Pages from the main branch root, or to any static host.

## Usage

1. Press Add bookmark, enter a URL, and optionally a title, description, collection, and favorite flag.
2. Use the top search bar to find links, and the All Bookmarks filters to narrow by collection or favorites.
3. On the Collections page, create groups and rename or delete them.
4. In Settings, export a JSON backup before clearing browser data, and import it later to restore.

## Data and safety

- Only http and https URLs are accepted. Other schemes, such as javascript: and data:, are rejected.
- Bookmark text is rendered as text, never as HTML, so a saved title or description cannot run code.
- Favicon images come from the Google favicon service for the saved site's domain; if a favicon is unavailable, a letter fallback is shown.
- Imported backups are checked for structure, valid URLs, unique ids, and existing collection references before any data is replaced.
