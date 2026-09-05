# BibleGuessr Web Docs

This folder contains the static HTML feature documentation for BibleGuessr.
Each feature has its own folder with an `index.html` file, and the landing page
is `index.html` in this directory.

## Open with VS Code Live Server

1. Open this repository in VS Code.
2. Install the **Live Server** extension if it is not already installed.
3. In the Explorer, open `docs/web/index.html`.
4. Right-click the file and choose **Open with Live Server**.
5. Use the feature cards on the page to navigate the docs.

Live Server usually opens a URL like:

```text
http://127.0.0.1:5500/docs/web/index.html
```

The pages use relative links and `docs/web/shared/styles.css`, so serving the
repository root or the `docs/web` folder both work as long as `index.html` and
`shared/styles.css` stay in the same relative locations.

## Adding a page

1. Create a folder under `docs/web`, for example `docs/web/example-feature/`.
2. Add an `index.html` file in that folder.
3. Link `../shared/styles.css` from the page.
4. Add a feature card to `docs/web/index.html`.
5. Keep the page static: HTML, CSS, and JavaScript only.

## Notes

These docs are for developers and reviewers. Keep the root `README.md` short;
put detailed feature behavior here in `docs/web`.
