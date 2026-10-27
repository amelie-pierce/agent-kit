# Zoetrope packaging follow-ups

These are handoff items for the maintained `pikenguyen227/zoetrope` fork. No change or message is being sent to that repository by this kit.

The pre-release [`fleet-v0.2.0-e81530fac3d7`](https://github.com/pikenguyen227/zoetrope/releases/tag/fleet-v0.2.0-e81530fac3d7) (commit `e81530fac3d7754df134dd3c8e995e29bb40104c`) is now pinned in the manifest. Its status against the original list:

1. **Closed for macOS.** It publishes macOS arm64 and x64 `zoe-fleet` archives from the approved commit, with `SHA256SUMS`, the MIT `LICENSE`, a `NOTICE` naming the build commit, and `BUILD.txt`. The kit installs the binary from these archives on macOS and no longer builds it from source there.
2. **Closed.** The fleet runtime archive ships the `fleet <manifest>` producer (`scripts/firstmate-fleet.py`, started by `fleet-plugin/open.sh` from a Herdr pane) and documents its contract in `docs/FLEET-PACKAGING.md`. The kit installs the runtime but never runs the producer.
3. **Closed.** The runtime's `bin/zoe-fleet-tower` launcher derives a per-home state directory, and its `setup` writes a private config. The kit runs `setup` with the person's own Firstmate home, the kit's `zoe-fleet`, and a new or empty state directory, then checks that the config names nothing else.
4. **Open: hands-on acceptance.** The maintainers' automated Phase A passed against these assets with Firstmate pin `3cebfb5e`. Phase B still needs one person: a Herdr pane, `zoe-fleet-tower open`, and one `fm-spawn.sh --secondmate` launch, followed by the runner's manifest checks. Until it passes, the kit reports the tower as `installed from verified release; hands-on acceptance pending (Zoetrope Phase B)` and keeps the result partial. Herdr and agent launches stay explicit and outside an ordinary kit install or check.

Remaining after this release:

- **Linux tower release.** There are no Linux assets yet. The packaging doc names `x86_64-unknown-linux-musl` and `aarch64-unknown-linux-musl` as later targets. Until a release adds them, Linux and WSL2 keep the cargo source-build fallback at the same commit, and no fleet runtime or launcher is configured there.
- **Phase B acceptance** (item 4 above), which is needed before the kit can report full tower parity.
- **Signing.** The release format has no code signing, notarization, or checksum signature. The kit relies on the SHA-256 values approved in the manifest.
