# `config/library-remote-type-mismatch`

- Category: **correctness**
- Default severity: **warning**

## Issue

A consumer loader can fail when its remote type does not match the producer library format.

## How to fix it

Align `library.type`, `remoteType`, and each remote object's `type`.

Override this rule with `rules["config/library-remote-type-mismatch"]`.

## Sources

- [Official source](https://module-federation.io/configure/library.html)
- [Official source](https://module-federation.io/configure/remotetype.html)
