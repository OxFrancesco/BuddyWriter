# BuddyWriter

BuddyWriter is a two-client writing project:

- `BuddyWriterDesktop`: a desktop writing app built with ElectroBun and Bun
- `BuddyWriterMobile`: a mobile client built with Expo Router

## Desktop

```bash
cd BuddyWriterDesktop
bun install
bun run dev
bun run typecheck
bun run build
```

## Mobile

```bash
cd BuddyWriterMobile
bun install
bun run start
```

## Notes

- The local `sources/` folder is reference material and is intentionally excluded from version control.
- The desktop app currently ships with local `views://` content and a restricted navigation allowlist.
