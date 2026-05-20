# ROM Placement

The Pokémon White ROM must be placed at:

```
./nds/pokemon-white.nds
```

The repository's `.gitignore` ensures `./nds/*.nds` is **never committed**.
Do not commit your ROM. Do not add it via `git add -f`. The CI and remote
have no copy and never will.

## Where to get the ROM
The user is responsible for legally sourcing the ROM. One public archive
that hosts NDS ROMs (no endorsement, no affiliation):

- https://romsfun.com/roms/nintendo-ds/pokemon-white-version.html

Save the downloaded file as `./nds/pokemon-white.nds`.

## Verification
```
./scripts/verify-rom.sh
```
Prints the file's SHA-1 hash and file size. The official US v1.0 ROM is
~256 MiB.

## Why not in the repo
- Legality: distributing ROMs is illegal in most jurisdictions.
- Size: a 256 MiB binary doesn't belong in git history.
- Security: a public repo with a known ROM hash is a takedown magnet.

## BIOS (optional)
DeSmuME can boot many DS games (including Pokémon White) without DS BIOS
files via "direct boot." If your build of DeSmuME needs them, place them
at `./bios/` — also gitignored.
