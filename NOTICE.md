# Notices and attributions

The MIT license in [LICENSE](LICENSE) covers the source code of this
project. It does not, and cannot, cover the Bible translations the project
loads — those are separate works with their own terms. This file records
what those are and where they come from.

## Bundled Bible text

`bibles/bibelen-dk/` contains a Danish translation of the Bible, in the
public domain:

- **Translation:** the Danish 1933 Bible — Old Testament from the 1931
  translation, New Testament from the 1907 translation.
- **Electronic edition:** prepared by Søren Hornstrup for
  [Project Runeberg](https://runeberg.org/), captured 26 July 1994.
- **Original source:** `ftp://dkuug.dk/pub/books/bibelen/bibelen.tgz`

The edition's own preface records that Det Danske Bibelselskab claims no
copyright beyond 50 years, and that the publisher of the original diskettes
claimed none either — which is why the translations used are as old as they
are. The text is therefore distributed here as a public-domain work.

This attribution is not a legal requirement for public-domain material. It
is here because the provenance of a text matters, and because anyone
redistributing this project should be able to see at a glance which parts
are ours to license and which are not.

## Translations that are *not* included

Copyrighted translations are deliberately absent from this repository, and
the architecture is built so they never need to be present.

Such translations are never loaded server-side. They work only through the
app's **"My own Bible file"** mode, where the player supplies their own
legally obtained file, it is parsed entirely in their browser, and the text
is cached locally and never uploaded. Only book, chapter, and verse numbers
ever cross the network — never verse text.

If you contribute to this project, do not commit Bible text, private
translations, or other copyrighted content. See
[CONTRIBUTING.md](CONTRIBUTING.md) and
[bibles/jw.org/README.md](bibles/jw.org/README.md).

## Third-party dependencies

All runtime and build dependencies are under permissive licenses. They are
not redistributed in this repository — they are fetched by npm and NuGet at
install time, and each retains its own license.

| Dependency | License |
| --- | --- |
| [Lit](https://lit.dev) | BSD-3-Clause |
| [@microsoft/signalr](https://github.com/dotnet/aspnetcore) | MIT |
| [fflate](https://github.com/101arrowz/fflate) | MIT |
| [TypeScript](https://www.typescriptlang.org/) | Apache-2.0 |
| [Vite](https://vite.dev) | MIT |
| [Vitest](https://vitest.dev) | MIT |
| [Playwright](https://playwright.dev) | Apache-2.0 |
| [FSharp.SystemTextJson](https://github.com/Tarmil/FSharp.SystemTextJson) | MIT |
| [xUnit.net](https://xunit.net/) | Apache-2.0 |
| ASP.NET Core / .NET | MIT |

None are copyleft, so this project's MIT license is compatible with all of
them.
