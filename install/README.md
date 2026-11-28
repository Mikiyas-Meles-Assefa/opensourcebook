# The one-line install

A person who has never used a terminal pastes one line, once, and Open Sourcebook is on their computer and open in their browser.

- Mac and Linux: `curl -fsSL https://opensourcebook.app/install | sh`
- Windows: `irm https://opensourcebook.app/install.ps1 | iex`
- With Node 24 already there: `npx opensourcebook`

This folder holds everything that makes those lines work. Nothing here is used by `npm start` in a clone.

## What each file is

| Path | What it is |
|---|---|
| `package/` | The npm package `opensourcebook`. No dependencies, plain `.mjs`. On a Node older than 24 it says so in one plain sentence. |
| `package/bin/opensourcebook.mjs` | The `opensourcebook` command: `install`, `update`, `where`, and with no arguments "install if needed, then start and open the browser". Anything else (`stop`, `status`, `check`, `open`, `make ...`, `help`) is passed straight to the app. |
| `package/source.json` | The one setting: the address the app is downloaded from. |
| `site/` | The folder served as is at `https://opensourcebook.app`. It is the site root and there is no build step. |
| `site/install` | The script behind the Mac and Linux line (POSIX `sh`). It finds Node 24 or keeps a private copy, runs the package's `install` through that Node's `npx`, then makes `opensourcebook` a command. |
| `site/install.ps1` | The same for Windows (PowerShell 5.1 and newer), with the PATH entry for the person and the Start menu shortcut. |
| `site/index.html` | The page a person sees. One file, with its styles and script inside it, and no requests to anywhere else. It shows the line for the visitor's system and works with scripts off. |
| `site/_headers` | Tells the host to send the two scripts as plain text with a short cache time, and to check for a newer page each time. |
| `test/try.sh` | Tries the whole line for real in a throwaway home: installs from a local archive and a local package, checks that the four programs answer, runs the line again, and stops it. |
| `test/script.sh` | Tries `site/install` by itself against a stand-in package: which Node it picks, the checksum, the PATH line, the failure sentences. |
| `../.github/workflows/install.yml` | Runs the package's tests, then the line on a bare Linux with no Node and no ffmpeg, and the Windows line in Windows PowerShell 5.1. |
| `README.md` | This file. |

## How the install works

Everything goes into one folder on the person's computer, `~/.opensourcebook`. Setting `OPENSOURCEBOOK_HOME` puts it somewhere else.

| In that folder | What it holds |
|---|---|
| `app/` | The app's files, unpacked from the archive. |
| `app.manifest` | The list of files the last archive put in `app/`, one path per line. An update removes files that were in the old list and are not in the new one, and nothing else. |
| `launcher/` | A copy of the npm package, so the command works without `npx`. |
| `bin/` | `opensourcebook` (and `opensourcebook.cmd` on Windows), and `ffmpeg` and `ffprobe` when the installer fetched them. |
| `settings.json` | The first port, only when the install was given `--ports-from`, so a later start uses the same ports. |
| `node/` | A private Node 24, only when the person had none. `node/bin/node` on a Mac and Linux, `node\node.exe` on Windows. |
| `tools/` | The npm folder used to fetch ffmpeg and ffprobe. |

Outside that folder the install writes only two things: what makes `opensourcebook` a command (a PATH line or a link), and the shortcut (`~/Applications/Open Sourcebook.app` on a Mac, `~/.local/share/applications/opensourcebook.desktop` on Linux, a Start menu shortcut on Windows). A person's own Node, projects and other folders are never touched. When Open Sourcebook starts, the launcher keeps the projects and settings in the app data folder, the same one the desktop app and a clone use (`docs/DEVELOPING.md`). It never asks for a password or administrator rights.

The order of things:

1. The script (`site/install` or `site/install.ps1`) looks for Node 24. If there is none it downloads one into `node/`.
2. It runs `opensourcebook install` from the npm package with that Node's `npx`.
3. `install` says what it will do, downloads the archive and unpacks it into `app/`, copies itself to `launcher/`, writes the command into `bin/`, fetches ffmpeg if `ffmpeg` is not already there (a failure here is a warning with one next step, not a stop), makes the shortcut, starts the app in the background and opens the browser.
4. The script makes `opensourcebook` a command.

Running it a second time is safe: it updates `app/` in place, stopping a running copy first.

**The one setting.** `package/source.json` holds the address of the archive:

```json
{ "archive": "https://github.com/Mikiyas-Meles-Assefa/opensourcebook/archive/refs/heads/main.tar.gz" }
```

The archive is a `.tar.gz` with one folder at the top (any name) holding the repo, which is what GitHub's source archives are. `OPENSOURCEBOOK_ARCHIVE`, an https address or a path to a local `.tar.gz`, wins over the file.

All the names the scripts and the package read:

| Name | What it does | Default |
|---|---|---|
| `OPENSOURCEBOOK_HOME` | The folder everything goes into. | `~/.opensourcebook` |
| `OPENSOURCEBOOK_ARCHIVE` | Where the app is downloaded from: an https address or a local `.tar.gz`. | the address in `package/source.json` |
| `OPENSOURCEBOOK_PACKAGE` | What the script gives to `npx`. A path to a local `.tgz` for tests. | `opensourcebook@latest` |
| `OPENSOURCEBOOK_NODE_DIST` | Where a private Node is downloaded from. | `https://nodejs.org/dist/latest-v24.x` |

Arguments after `sh -s --` go on to `opensourcebook install`: `--no-start`, `--no-open`, `--ports-from N`.

## Testing it locally

Never run an installer against your real home folder. Every run below uses a throwaway home, a local archive and a private set of ports, so it cannot touch a copy of Open Sourcebook you use.

The short way, which does all of the steps below and checks each one (it refuses to run in a home that already has Open Sourcebook):

```sh
HOME="$T/home" sh install/test/try.sh "$T/app.tar.gz" "$PACKAGE" 9300
```

By hand, from the root of the repo:

```sh
T="$(mktemp -d)"
mkdir "$T/home"

# 1. A local archive, shaped like the one GitHub serves. It holds what is committed, not unsaved changes.
git archive --format=tar.gz --prefix=opensourcebook-main/ HEAD -o "$T/app.tar.gz"

# 2. The npm package as a file, without publishing it.
(cd install/package && npm pack --pack-destination "$T")
PACKAGE="$(ls "$T"/opensourcebook-*.tgz)"

# 3. The Mac and Linux line, against those two files.
HOME="$T/home" \
OPENSOURCEBOOK_HOME="$T/home/.opensourcebook" \
OPENSOURCEBOOK_ARCHIVE="$T/app.tar.gz" \
OPENSOURCEBOOK_PACKAGE="$PACKAGE" \
  sh install/site/install --no-open --ports-from 9300

# 4. Look, then stop it and throw the home away.
HOME="$T/home" OPENSOURCEBOOK_HOME="$T/home/.opensourcebook" "$T/home/.opensourcebook/bin/opensourcebook" where
HOME="$T/home" OPENSOURCEBOOK_HOME="$T/home/.opensourcebook" "$T/home/.opensourcebook/bin/opensourcebook" status
HOME="$T/home" OPENSOURCEBOOK_HOME="$T/home/.opensourcebook" "$T/home/.opensourcebook/bin/opensourcebook" stop
rm -rf "$T"
```

Things to know:

- With a throwaway home, npm starts with an empty cache and the first start downloads the browser that videos are drawn with, so the run takes a few minutes and a few hundred megabytes. Add `--no-start` to check only the download, the unpacking and the files written.
- To test the package without the script, run `node install/package/bin/opensourcebook.mjs install --no-open --ports-from 9300` with the same `HOME`, `OPENSOURCEBOOK_HOME` and `OPENSOURCEBOOK_ARCHIVE`.
- To test the private Node, run step 3 with a `PATH` that has no `node` on it. It downloads Node from `OPENSOURCEBOOK_NODE_DIST`.
- Run step 3 twice to check that a second install is safe, and once more after a commit that deletes a file to check that the file leaves `app/`.
- On Windows the same names work in PowerShell: set `$env:USERPROFILE`, `$env:OPENSOURCEBOOK_HOME`, `$env:OPENSOURCEBOOK_ARCHIVE` and `$env:OPENSOURCEBOOK_PACKAGE`, then run `install\site\install.ps1`.
- Always stop a copy you started before deleting its folder.

To look at the page:

```sh
python3 -m http.server 9500 --bind 127.0.0.1 --directory install/site
```

Then open `http://127.0.0.1:9500`. That server does not read `_headers`, so it says nothing about how the scripts will be served; step 3 of "Publishing it" checks that.

## Publishing it

In this order. Each step has a check, and the next step waits for it.

1. **Make the repository public** at `github.com/Mikiyas-Meles-Assefa/opensourcebook`. Then confirm that the address in `install/package/source.json` downloads:

   ```sh
   curl -fsSLI https://github.com/Mikiyas-Meles-Assefa/opensourcebook/archive/refs/heads/main.tar.gz
   ```

   The last answer should be `200`. If the repository has another address, change that one line in `source.json` and commit it. That is the single thing to flip. (The page and the root `README.md` also show the repository's address to people who want the code; they do not take part in the install.)

2. **Publish the package.**

   ```sh
   cd install/package && npm publish
   ```

   The npm account asks for its two-factor code. Then check, from any other folder:

   ```sh
   npx opensourcebook@latest where
   ```

   It should print the home folder and the archive address from step 1.

3. **Put `install/site/` on `opensourcebook.app`.** This is done: the folder is served by a Cloudflare Worker with static assets named `opensourcebook-site`, set up in `install/wrangler.jsonc`, which reads `_headers` and holds the domain as its custom domain (Cloudflare made the DNS record and the certificate). To publish a change to the page or a script, run `npx wrangler deploy` from `install/`, signed in with `npx wrangler login` to the account that holds the domain. There is no build step. `www.opensourcebook.app` is a second custom domain of the same Worker: `worker.js` runs first and sends it, and plain `http://`, to `https://opensourcebook.app` with a 301 that keeps the path and query, and hands every other request to the folder as it is (the `_headers` rules still apply). The folder also serves `llms.txt`, a plain-text summary for agents. Check that both scripts come back as scripts and not as a web page:

   ```sh
   curl -fsSL https://opensourcebook.app/install | head -5
   curl -fsSL https://opensourcebook.app/install.ps1 | head -5
   curl -fsSI https://opensourcebook.app/install | grep -i content-type
   ```

   The first lines should be the scripts' own, not `<!doctype html>`, and the type should be `text/plain; charset=utf-8`. If a script comes back as HTML or as a download, the host is not reading `_headers`.

4. **Try the three lines once each on a computer that has never had it**: the Mac and Linux line on a Mac, the same line on Linux, and the Windows line on Windows. Each should end with the browser open on Open Sourcebook. Then close the terminal, open a new one and type `opensourcebook`.

## What has been tried, and what has not

Tried for real, on a Mac with an Apple chip, in a throwaway home on private ports, against a local archive and a local package:

- The line piped into `sh` with no Node and no ffmpeg on the PATH: a private Node 24 was downloaded and its checksum matched, the app was unpacked, ffmpeg and ffprobe were fetched, the four programs answered, a second run updated and started again with the person's files kept, and `stop` stopped it (`test/try.sh`).
- The line fetched with `curl` from a local copy of the site, and `opensourcebook` found as a command in a new terminal.
- `npx` with the local package, with Node 24 already there.
- The script by itself under `sh` and `dash`: every failure sentence, the PATH line for zsh, bash and fish, and the choice of download for each system (`test/script.sh`).

Tried for real from the public addresses, on the same Mac on 2026-11-24:

- `curl -fsSL https://opensourcebook.app/install | sh -s -- --no-open --ports-from 9300` into a throwaway home with no Node on the PATH: the script came from `opensourcebook.app` as `text/plain`, the package from npm (`opensourcebook@0.1.0`) and the app from the GitHub archive; a private Node 24 and ffmpeg were fetched, it ended with exit 0, `status` showed the four programs up, and `stop` stopped them.
- The page, `install.ps1`, `robots.txt`, `sitemap.xml` and `og.png` answer on the domain, with the `_headers` rules applied.

Not tried yet:

- **Windows, at all.** `site/install.ps1` and the Windows parts of the package (`opensourcebook.cmd`, the Start menu shortcut, the PATH entry, unpacking with Windows' `tar`) have only been read, never run. The app itself is also not yet proven on Windows.
- **Linux for real.** The script's Linux choices were tried with a stand-in `uname`; nothing has run on a Linux computer. The `wget` path has not run either.
- **The automated check** (`.github/workflows/install.yml`) covers both of those and has not run once.
- **The shortcut.** `Open Sourcebook.app` is made and well formed, and has not been opened from Finder. The Linux menu entry has not been seen in a menu.
- An Intel Mac, a home folder with a space in its name, and a real Node older than 24 meeting `npx opensourcebook`.

Removing it: deleting the folder removes Open Sourcebook. Your projects and settings are not in it: every copy of Open Sourcebook on the computer keeps them in the app data folder (`~/Library/Application Support/Open Sourcebook` on a Mac, `%APPDATA%\Open Sourcebook` on Windows, `~/.local/share/Open Sourcebook` on Linux), so they stay until that folder is deleted too. The shortcut, the one PATH line in the shell's profile and the browser for videos in the computer's cache folder stay until they are deleted by hand.
