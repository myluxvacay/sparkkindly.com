# Media and File Storage Rules

Brand assets and the mock-up's imagery live in `public/` with their licences recorded (`public/brand/README.md`,
`docs/ASSETS.md`). Everything else binary stays out of Git.

Generated item images (templates) and any uploaded files (contributor media, finished videos for the jobs queue)
are written under `/opt/sparkkindly/shared/media/` on the VM and served by the app. The database stores the
path, checksum, origin (`template`, `stock`, `generated`, `owner-supplied`, `contributor`) and licence, never the bytes.

Upload flow for any file a person supplies:
intent → authenticated, size-limited upload → quarantine directory → validation (type, MIME, size, name, path,
checksum) → owner approval where the pipeline requires it → published location.

Generated files must be reopened/read after creation before claiming success.
Never commit uploaded media, generated builds (`.next/`, `out/`, `release/`, `*.tgz`) or backups.
