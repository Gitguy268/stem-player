# Contributing

Issues and pull requests are welcome.

## Setup

```sh
npm ci
npm run dev
```

## Before opening a pull request

Run `npm run verify`. If you changed input, audio or rendering, run `npm run build` and `npm run check:browser` too.

## Guidelines

- Keep device facts in `src/spec`, and record where each came from in `docs/PARITY.md`. If you know a detail marked reconstructed, please send the source.
- Controllers stay pure, and each new behaviour gets a unit test.
- Don't add logos, product photos, product videos or commercial music. `docs/reference` is ignored by git for this reason.
- Don't copy code from projects with no licence or a copyleft one. Ideas are fine, with credit in `NOTICE`.
- Keep commits small and focused, and add a dependency only for a clear reason.
