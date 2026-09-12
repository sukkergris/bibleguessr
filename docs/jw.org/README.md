# Local Bible Test Data

This folder is used by tests and local development that exercise uploaded Bible
files. The repository does not provide copyrighted Bible text here.

To run those tests, provide your own legally obtained Bible files. Keep the
files in this directory without committing them. For example, you can use:

- An RTF export containing the required Bible books, optionally packaged as a
  ZIP file.
- An EPUB export.
- Files in multiple languages, if the test or local workflow requires them.

The exact file names and supported formats depend on the test being run. Check
the relevant frontend fixtures and parser tests before preparing a file.

## Terms of use

Only add files that you are permitted to download, store, and use for local
testing. Do not commit Bible text, private translations, or other copyrighted
content to this repository.

This `README.md` and `.gitkeep` are intentionally tracked so this folder's
purpose and structure remain visible even when the local test data is absent.
