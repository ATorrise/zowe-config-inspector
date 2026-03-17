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

### Hover Tooltips

Hover over any property to see documentation explaining what it does and how to use it.

### Inspector Dashboard

Run `Zowe Inspector: Open Dashboard` from the Command Palette for a comprehensive diagnostic view:

- **Issues Overview** - Clickable errors and warnings that jump to the exact location
- **Profile Cards** - All your configured profiles with connection test buttons
- **Connection Testing** - Test SSH and z/OSMF connectivity with latency display
- **Environment Status** - Node.js version, Zowe CLI version, credential manager status
- **Inheritance Visualization** - See which properties are inherited from parent profiles

### Layer Visualization

Run `Zowe Inspector: Show Config Layers & Inheritance` to see:

- All active configuration files (global, project, user)
- Which profiles are defined where
- Which layer "wins" when there are conflicts

### Credentials & SSH Keys

Run `Zowe Inspector: Credentials & SSH Keys` to:

- View all SSH keys in `~/.ssh`
- Check credential manager status
- Copy public keys to clipboard
- Generate new SSH keys (shows commands in terminal)

### 🔧 Environment Check

Run `Zowe Inspector: Check Environment & Versions` to see:

- Node.js version
- Zowe CLI version
- ZOWE_CLI_HOME location
- Installed Zowe-related VS Code extensions
- Global npm packages

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
| `Zowe Inspector: Validate Configuration` | Validate the current file and show summary |
| `Zowe Inspector: Show Config Layers & Inheritance` | View all config files and their precedence |
| `Zowe Inspector: Credentials & SSH Keys` | View SSH keys and credential manager status |
| `Zowe Inspector: Check Environment & Versions` | Check Node.js, Zowe CLI, and extension versions |
| `Zowe Inspector: Generate SSH Key` | Generate a new SSH key pair |
| `Zowe Inspector: Update Zowe CLI` | Update Zowe CLI to latest version |

### Context Menus

Right-click on any `zowe.config.json` file in:
- **Editor** - "Validate Configuration" and "Show Layers" options
- **Explorer** - "Validate Configuration" and "Open Dashboard" options

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

### Info (Blue Squiggles, optional)

- Both password and privateKey set
- Localhost as mainframe host
- No profiles defined

## Dashboard Features

The Inspector Dashboard provides an interactive diagnostic experience:

### Issues Section
- All validation errors and warnings grouped by file
- Click any issue to jump directly to that line in the editor
- Shows line numbers and detailed suggestions

### Profiles Section
- Visual cards for each profile showing type and source file
- **Test Connection** button for SSH and z/OSMF profiles
- Real-time connection status with latency measurement
- Collapsible "Inherited Properties" showing what comes from parent profiles

### Environment Section
- Zowe CLI version and installation status
- Node.js version
- ZOWE_CLI_HOME environment variable
- Credential manager availability

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

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.

## License

This project is licensed under the Eclipse Public License 2.0 - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Zowe](https://www.zowe.org/) - The open source project for z/OS
- [Zowe Explorer](https://github.com/zowe/zowe-explorer-vscode) - VS Code extension for Zowe
