---
title: Architecture notes
description: Read-only CLI boundaries and platform routing
date: 2026-10-26
---

# Architecture

- [Read-only boundary](read-only-boundary.md) — command evaluation and platform routing.
- [macOS install](macos-install.md) — staging, ownership receipts, source boundaries and partial tower status.
- [Linux and WSL2 install](linux-install.md) — platform checks, Linux artifact selection and CI smoke boundary.
- [Tower release install](tower-release.md) — macOS release archives, runtime launcher configuration and acceptance-pending parity.
- [Global registration](global-registration.md) — owned hook and skill merge, preview and trust boundary.
- [Windows entry and WSL2 handoff](windows-entry.md) — PowerShell bootstrap, read-only WSL preflight, guided steps and the pinned handoff into Linux.
- [Doctor and reviewed updates](doctor-update.md) — receipt health, versioned update staging, deferred activation and template boundary.
- [Kit lifecycle commands](lifecycle.md) — receipt-scoped repair, reviewed upgrade, uninstall and rollback boundaries.
- [Single installer and guided setup](single-installer.md) — install.sh/install.ps1, root-derived layout, prompts and saved answers, summary gate and step resume.
