# Zowe Config Inspector

A diagnostic tool for Zowe CLI - validate configurations, analyze inheritance, check credentials, test connections, and troubleshoot your mainframe development environment.

![Demo](resources/demo.gif)

## Features

### Real-Time Validation

As you edit `zowe.config.json`, errors and warnings appear immediately with red squiggly underlines:

- **JSON syntax errors** with helpful messages
- **Schema validation** - wrong property types, unknown properties
- **Common mistakes** - port as string, host with protocol, missing files
- **Profile reference errors** - defaults pointing to non-existent profiles

### Inspector Dashboard

Run `Zowe Inspector: Open Dashboard` from the Command Palette for a comprehensive diagnostic view with tabbed navigation:

**Dashboard Tab:**
- **Issues Overview** - Clickable errors and warnings that jump to the exact location
- **Profile Cards** - All your configured profiles with connection test buttons
- **Connection Testing** - Test SSH and z/OSMF connectivity with latency display
- **Inheritance Visualization** - See which properties are inherited from parent profiles

**Environment Tab:**
- System status: Node.js, Zowe CLI (with Update button), ZOWE_CLI_HOME, Credential Manager, SSH Keys
- Zowe environment variables - view set variables, add new ones from curated list
- Installed Zowe-related VS Code extensions (with Update buttons)

**Credentials Tab:**
- View all SSH keys in `~/.ssh`
- Check credential manager status (Windows/macOS/Linux)
- Copy public keys to clipboard
- Generate new SSH keys (Ed25519, RSA, ECDSA)

**Layers Tab:**
- All configuration files (global, project, user) with priority ordering
- Which profiles are defined where
- Override detection - see which layer "wins" when there are conflicts

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Ctrl+Shift+X`)
3. Search for "Zowe Config Inspector"
4. Click Install

### From VSIX File

```bash
code --install-extension zowe-config-inspector-0.1.0.vsix
```

## Usage

The extension activates automatically when you:
- Open a workspace containing `zowe.config.json`
- Open any `zowe.config.json` or `zowe.config.user.json` file

### Commands

Open the Command Palette (`Ctrl+Shift+P`) and search for:

| Command | Description |
|---------|-------------|
| `Zowe Inspector: Open Dashboard` | Open comprehensive diagnostic dashboard |

All other features (validation, environment check, credentials, SSH key generation, CLI update) are accessible from within the Dashboard tabs.

### Context Menus

Right-click on any `zowe.config.json` file in the file explorer or an open tab to open the Dashboard.

Right-click on a profile/session node in Zowe Explorer's Data Sets, USS, or Jobs tree to select "Inspect Profile" (not available on favorites).

### Settings

Configure the extension via VS Code settings:

```json
{
  "zoweInspector.enableRealTimeValidation": true,
  "zoweInspector.validateOnSave": true,
  "zoweInspector.showInfoDiagnostics": false,
  "zoweInspector.checkSshKeyExists": true,
  "zoweInspector.autoCheckOnStartup": false
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `enableRealTimeValidation` | `true` | Validate as you type |
| `validateOnSave` | `true` | Full validation on save |
| `showInfoDiagnostics` | `false` | Show informational hints |
| `checkSshKeyExists` | `true` | Verify SSH private key files exist |
| `autoCheckOnStartup` | `false` | Run environment check when VS Code starts |

## What It Catches

### Errors (Red Squiggles)

- Invalid JSON syntax
- Port specified as string (`"22"` instead of `22`)
- Host includes protocol (`https://example.com` instead of `example.com`)
- Default profile references non-existent profile
- SSH private key file not found
- Smart quotes (curly quotes) in JSON

### Warnings (Yellow Squiggles)

- Unknown properties (with "did you mean?" suggestions)
- TLS verification disabled (`rejectUnauthorized: false`)
- Empty profiles with no configuration
- Secure properties stored in plaintext
- UTF-8 BOM detected

### Info (Blue Squiggles)

These are hidden by default. To enable, add this to your VS Code settings:

```json
{
  "zoweInspector.showInfoDiagnostics": true
}
```

Info diagnostics include:
- Both password and privateKey set (dual authentication)
- Localhost as mainframe host
- No profiles defined
- Possible typos in property names

## Example

Given this `zowe.config.json`:

```json
{
  "profiles": {
    "myhost": {
      "type": "ssh",
      "properties": {
        "host": "https://mainframe.example.com",
        "port": "22",
        "usr": "ibmuser",
        "privateKey": "~/.ssh/nonexistent_key"
      }
    }
  },
  "defaults": {
    "ssh": "wrong_profile_name"
  }
}
```

The extension will show:

1. ❌ `host` should not include protocol
2. ❌ `port` should be a number, not a string
3. ⚠️ Unknown property `usr` - did you mean `user`?
4. ❌ Private key file not found
5. ❌ Default profile `wrong_profile_name` does not exist

## Works With Zowe Explorer

This extension works alongside [Zowe Explorer](https://marketplace.visualstudio.com/items?itemName=Zowe.vscode-extension-for-zowe). It focuses on **diagnostics and analysis** while Zowe Explorer handles profile management and data set operations.

## Building from Source

```bash
# Clone the repository
git clone https://github.com/ATorrise/zowe-config-inspector.git
cd zowe-config-inspector

# Install dependencies
npm install

# Compile
npm run compile

# Package as VSIX
npm run package
```

## Technical Notes

### Process Management

This extension is designed to minimize resource usage:

- **No background processes** - The extension does not spawn long-running processes or poll external commands
- **Single reusable terminal** - All CLI operations (Zowe CLI updates, SSH key generation, environment variable setup) use a single managed VS Code terminal that is reused and properly disposed
- **Lazy loading** - Data is only loaded when the relevant Dashboard tab is active
- **Caching** - Expensive operations like listing extensions are cached and reused
- **No automatic CLI calls** - The extension detects Zowe CLI installation by checking for config files rather than running `zowe --version`

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the Eclipse Public License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Zowe](https://www.zowe.org/) - The open source project for z/OS
- [Zowe Explorer](https://github.com/zowe/zowe-explorer-vscode) - VS Code extension for Zowe
