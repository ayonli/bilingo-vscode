# Changelog

All notable changes to the Bilingo VSCode extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - 2026-01-08

### Added

#### Interface Reference Finding

- **Go Interface ↔ TypeScript Interface** cross-language reference finding
  - Find references for interfaces with methods between Go and TypeScript
  - Example: Find all references of `UserService` interface across Go and TypeScript files
  - Supports both directions: Go → TS and TS → Go

#### Interface Method Reference Finding

- **Go Interface Method ↔ TypeScript Interface Method** cross-language reference finding
  - Find references for interface methods between Go and TypeScript
  - Example: Find all references of `GetUser()` method in `UserService` interface
  - Method name conversion: Go `GetUser` ↔ TypeScript `getUser`
  - Requires parent interface name to match exactly

#### Type Alias Reference Finding

- **Go Type Constraint ↔ TypeScript Type Alias** cross-language reference finding
  - Support for Go type constraint interfaces (union types)
  - Example: Go `type ApiResult[T any] interface { SuccessResult[T] | ErrorResult }` ↔ TypeScript `type ApiResult<T> = SuccessResult<T> | ErrorResult`
  - Automatically distinguishes between regular interfaces and type constraints

#### Interface Implementation Finding

- **Go Interface ↔ TypeScript Interface** cross-language implementation finding
  - Find implementations of interfaces across languages
  - Example: From Go `UserService` interface, find TypeScript `UserServiceImpl` class
  - Uses VS Code's built-in implementation provider (gopls for Go, TypeScript language server for TS)
  - Returns both the interface declaration and all implementing classes/structs

#### Struct/Interface Type Matching

- **Go Struct ↔ TypeScript Interface** bidirectional matching
  - Go struct (data structure) ↔ TypeScript interface (without methods)
  - Go interface (with methods) ↔ TypeScript interface (with methods)
  - Automatic detection based on whether the interface has methods

### Changed

#### Configuration: `strictAccessibility` → `strictExport`

- **Breaking Change**: Renamed configuration from `bilingo-vscode.strictAccessibility` to `bilingo-vscode.strictExport`
- **Behavior Change**: Changed from "matching accessibility status" to "only exported"

  **Before (`strictAccessibility`):**
  - `true`: Go exported functions only match TS exported functions, Go unexported only match TS unexported
  - `false`: Match regardless of export status

  **After (`strictExport`):**
  - `true`: Only match exported functions (Go capitalized + TS exported)
  - `false`: Match all functions regardless of export status (default)

- **Migration Guide:**
  ```json
  // Old configuration (no longer works)
  {
    "bilingo-vscode.strictAccessibility": true
  }

  // New configuration
  {
    "bilingo-vscode.strictExport": true
  }
  ```

#### Code Refactoring

- Extracted specialized lookup functions for better maintainability:
  - `findGoFunctionForTsFunctionViaMatching` - Function matching
  - `findGoStructForTsInterfaceViaMatching` - Struct/Interface matching
  - `findTsInterfaceForGoStruct` - Direct interface lookup
  - `findGoInterfaceForTsInterface` - Bidirectional interface lookup
  - `findTsTypeAliasForGoInterface` - Type alias lookup
  - And many more specialized functions

- Added `isGoSymbolExported()` helper function to check Go symbol export status
- Simplified struct/interface matching logic (removed unnecessary `calculateMatchScore` usage)
- Removed `strictExport` parameter from struct/interface matching (only applies to functions)

### Fixed

- Corrected `strictExport` (formerly `strictAccessibility`) scope to only affect function matching
  - Struct and interface matching always requires exported symbols
  - This aligns with the configuration description in `package.json`

## [0.1.0] - Previous Release

### Added

- Initial release with basic cross-language reference finding
- Support for function and struct/interface matching between Go and TypeScript
- Field/property reference finding
- Enum constant reference finding

---

## Feature Summary

### Supported Cross-Language Features

| Feature                          | Go           | TypeScript                | Reference | Implementation |
| -------------------------------- | ------------ | ------------------------- | --------- | -------------- |
| **Functions**                    | ✅           | ✅                        | ✅        | ✅             |
| **Struct ↔ Interface**           | ✅ struct    | ✅ interface (no methods) | ✅        | ✅             |
| **Interface (with methods)**     | ✅ interface | ✅ interface              | ✅        | ✅             |
| **Interface Methods**            | ✅           | ✅                        | ✅        | ❌             |
| **Struct Fields ↔ Properties**   | ✅           | ✅                        | ✅        | ❌             |
| **Type Constraint ↔ Type Alias** | ✅           | ✅                        | ✅        | ❌             |
| **Enum Constants**               | ✅ const     | ✅ export const           | ✅        | ❌             |

### Configuration Options

| Option                        | Type    | Default | Description                   |
| ----------------------------- | ------- | ------- | ----------------------------- |
| `bilingo-vscode.enable`       | boolean | `true`  | Enable/disable the extension  |
| `bilingo-vscode.strictExport` | boolean | `false` | Only match exported functions |

---

**Note**: This changelog documents recent major updates. For the complete version history, see the git commit log.
