# Changelog

All notable changes to the Zowe Config Inspector extension will be documented in this file.

This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- **Tabbed Dashboard Interface** - Single unified panel with tabs for Dashboard, Environment, Credentials, and Layers
- Zowe environment variables section - view currently set variables, add new ones from a curated list
- SSH key generation and management in Credentials tab
- Support for setting environment variables (session or permanent) with platform-appropriate commands

### Changed

- Simplified command palette to single "Open Dashboard" entry - all features accessible from Dashboard tabs
- Consolidated all separate panels (Environment, Credentials, Layers) into the main Dashboard
- "Inspect Profile" context menu now only appears on session nodes, not on favorites

## [0.1.0] - 2026-03-17

### Added

- Initial release of Zowe Config Inspector
- Dashboard view with tabbed interface (Configuration, Environment, Credentials, Layers)
- Real-time validation of `zowe.config.json` files with inline diagnostics
- Configuration layer visualization showing inheritance hierarchy
- Credential and SSH key status checking
- Environment diagnostics (Zowe CLI version, Node.js version, plugins)
- SSH key generation wizard
- Profile validation from Zowe Explorer tree views context menu
- JSON Schema validation for Zowe configuration files
- Settings for customizing validation behavior

[Unreleased]: https://github.com/ATorrise/zowe-config-inspector/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/ATorrise/zowe-config-inspector/releases/tag/v0.1.0
