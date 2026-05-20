# Cheats

This document explains the Action Replay codes used to make Pokémon White
playable under emulation.

## Why cheats are needed

Pokémon Black/White include an anti-piracy (AP) check that blocks EXP gain
when the game detects it is running from a flash cart or emulator. Without
disabling this check, Pokémon never level up — making it impossible to beat
the Striaton Gym and earn the Trio Badge.

## The codes

The DeSmuME cheat database at `containers/emulator/cheats/pokemon-white-us.dct`
contains the following Action Replay codes:

### Active (enabled by default)
- **"Disable No Exp AP" (White v1.0 US)**

### Reference (disabled by default)
- **"Disable No Exp AP" (Black v1.0 US)** — included for users who own Black
  instead of White.

## How they are loaded

The emulator container mounts `containers/emulator/cheats/` and loads the
`.dct` file via DeSmuME's `--cheats` command-line flag (see the container
entrypoint script for details).

## Sources

- https://gbatemp.net/threads/how-to-patch-pokemon-black-and-white.263688/
- http://dscodesaction.blogspot.com/2010/08/pokemon-black-and-white.html
- https://gbatemp.net/threads/exp-patch-codes-for-pokemon-black-white-black-2-and-white-2.563021/

## Legality

These codes are public knowledge published by the community for over a
decade. We use them solely to allow a legitimately-owned ROM dump to
function correctly under emulation. Users are responsible for compliance
with applicable laws regarding ROM acquisition and emulation in their
jurisdiction.
