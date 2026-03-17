# Example Configuration Files for Screenshots

These files are designed to showcase all validation features of the Zowe Config Inspector.
Copy them to a test workspace to capture screenshots for documentation.

## zowe.config.json (Global/Project Config)

### Errors (Red Squiggles)
| Line | Issue | Description |
|------|-------|-------------|
| 7 | `host` | Includes protocol `https://` - should be just hostname |
| 8 | `port` | String `"443"` instead of number `443` |
| 10 | `responseTimeout` | Value 700 is outside valid range (5-600) |
| 17 | `privateKey` | File `~/.ssh/nonexistent_key` doesn't exist |
| 24 | `port` | Value 70000 is outside valid range (1-65535) |
| 33 | `protocol` | Invalid value `"ftp"` - must be `"http"` or `"https"` |
| 48 | `"bad secure"` | Profile name contains whitespace |
| 55 | `ssh` default | References non-existent profile `missing_profile` |

### Warnings (Yellow Squiggles)
| Line | Issue | Description |
|------|-------|-------------|
| 9 | `rejectUnauthorized` | TLS verification disabled (security risk) |
| 23 | `hots` | Unknown property - did you mean `host`? |
| 31-32 | `user`, `password` | Credentials in plaintext (should be in secure store) |
| 34 | `encoding` | String value - typically should be a number like `1047` |
| 38 | `host` | Using `localhost` for mainframe connection |
| 43 | `empty_profile` | Has type but no properties |
| 52 | `secure` array | `"user"` is duplicated |

### Info (Blue Squiggles - when enabled)
| Line | Issue | Description |
|------|-------|-------------|
| 38 | `localhost` | Unusual for mainframe connection |

## zowe.config.user.json (User Override Config)

### Errors (Red Squiggles)
| Line | Issue | Description |
|------|-------|-------------|
| 14 | `port` | String `"22"` instead of number `22` |

### Warnings (Yellow Squiggles)
| Line | Issue | Description |
|------|-------|-------------|
| 7 | `pasword` | Typo - did you mean `password`? |
| 15-16 | dual auth | Both `password` and `privateKey` specified |

## All Validations Covered

### Type Validations
- Port must be a number (not string)
- Port must be 1-65535
- Protocol must be "http" or "https"
- Encoding is typically a number
- responseTimeout must be 5-600 seconds

### Host Validations
- Host should not include protocol (http:// or https://)
- Host should not contain spaces
- Localhost warning for mainframe connections

### Profile Validations
- Profile name should not contain whitespace
- Empty profiles (no type, properties, or sub-profiles)
- Default profile references must exist

### Security Validations
- rejectUnauthorized: false is a security risk
- Secure properties should not also be in properties (plaintext exposure)
- Duplicate entries in secure array

### SSH-Specific
- Private key file must exist
- Warning when both password and privateKey are set

### Typo Detection
- Unknown properties with suggestions (Levenshtein distance)

## How to Use

1. Create a new folder for testing
2. Copy both files to that folder
3. Open the folder in VS Code
4. Enable info diagnostics in settings:
   ```json
   { "zoweInspector.showInfoDiagnostics": true }
   ```
5. Open the Zowe Config Inspector Dashboard
6. Take screenshots
