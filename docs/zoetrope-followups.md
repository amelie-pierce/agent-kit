# Zoetrope packaging follow-ups

These are handoff items for a future PR to the maintained `pikenguyen227/zoetrope` fork. No change or message is being sent to that repository by this PR.

1. Publish a release archive for macOS arm64 and x64 from the approved commit, with SHA-256 checksums and the MIT notice. The kit currently verifies a pinned source archive and builds `zoe` with `cargo build --locked --release --bin zoe` when a compatible toolchain is available.
2. Specify and package the producer of the `fleet <manifest>` input. The source/build pin alone does not establish where a new personal Firstmate home gets its fleet manifest.
3. Provide a user-relative launcher that points to that person's empty fleet state and their own Firstmate home. Avoid references to an existing owner's paths, account pins, recordings, or project registrations.
4. Add an isolated acceptance run proving a teammate can create a local second mate and see only their own fleet in the tower. Keep Herdr and agent launches explicit and outside an ordinary kit install or check.

Until these are tested, Agent Kit reports tower parity as unavailable or unverified and returns a partial-install status.
