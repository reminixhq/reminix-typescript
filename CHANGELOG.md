# Changelog

What changed in the Reminix TypeScript SDK (`@reminix/sdk`). Generated from the source on each release; newest first.

## 1.0.0-rc.6 (2026-10-19)

### Changed

- - `reminix run` waits through a person's approval, as the SDKs' `run`
    does: it prints where to approve the run, then follows it to the end.
    `--no-wait` answers at once instead.
  - A cancelled run says why, in every client: "Run run_… was cancelled:
    The approval was denied" (the run's `error`). The CLI no longer prints
    "failed: null".
  - Files are uploaded without a guessed type; the API takes it from the
    file's name, the same way for every client. `reminix run --file` no
    longer reads the script first: one file is sent as one id, and the API
    takes it for an input that is a list of files.
  - Publishing is one call. `scriptVersions.create` (Upload a version)
    takes `create`, `name`, `description` and `publish`: it can make a new
    script, rename one, and publish the upload, answering with an
    `approval` link when a person must approve. Without `readme`, the
    folder's `README.md` is used. `reminix publish` uses it, so a name or
    description changed in `reminix.json` now reaches the script.
  - `reminix init` works out the command the same way `publish` does, so
    the two agree on every folder (an entry like `main.py` beside other
    scripts, `pyproject.toml`, `package.json`).

## 1.0.0-rc.5 (2026-10-16)

### Changed

- The TypeScript SDK's guide is at `/docs/typescript/`, beside `/docs/python/` and `/docs/cli/`.

## 1.0.0-rc.4 (2026-10-16)

### Added

- Each release comes with a `CHANGELOG.md` listing what changed, newest first.

### Changed

- The package page (README, on GitHub, npm and PyPI) shows what the product does with a first real example, and links the guide, the API reference, the changelog and support.

## 1.0.0-rc.3 (2026-10-16)

No user-facing changes.
