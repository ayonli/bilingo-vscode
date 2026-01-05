# Bilingo VSCode Extension

Find function references between Go and TypeScript in bilingual projects (Bilingo = **Bilin**gual + **Go**).

## Features

- **Cross-Language Reference Finding**: Seamlessly find references between Go and TypeScript functions
- **Native Integration**: Works directly with VSCode's built-in "Find All References" feature
- **Smart Name Matching**: Automatically handles case conversion (PascalCase ↔ camelCase)
- **Accessibility Matching**: Optional strict mode to match exported/unexported functions

## Rules

- **Same-Directory Scope**: Go and TS functions must be declared in the same directory
- **Top-Level Functions Only**: Only match top-level functions, excludes struct/class methods and
  nested functions

## Usage

Simply use the native "Find All References" feature (right-click → "Find All References" or press
`Shift+F12`) on any function name in Go or TypeScript files. The extension will automatically find
references in both languages.

### Example

When you trigger "Find All References" on a Go function:

```go
// api/article.go
func GetArticle(id string) Article {
    // ...
}
```

The extension will find the corresponding TypeScript function in the same directory:

```typescript
// api/article.ts
export function getArticle(id: string) {
    // ...
}
```

And display all their references in the References View.

## Configuration

### `bilingo-vscode.enable`

**Type:** `boolean`\
**Default:** `true`

Enable or disable the extension in the current workspace.

```json
{
    "bilingo-vscode.enable": true
}
```

### `bilingo-vscode.strictAccessibility`

**Type:** `boolean`\
**Default:** `false`

When enabled, only matches functions with the same accessibility:

- Go **capitalized** functions ↔ TypeScript **export**ed functions
- Go **non-capitalized** functions ↔ TypeScript **non-exported** functions

```json
{
    "bilingo-vscode.strictAccessibility": true
}
```

#### Example with Strict Accessibility

**Matches:**

- `func GetArticle` (Go) ↔ `export function getArticle` (TS) ✅
- `func getArticle` (Go) ↔ `function getArticle` (TS) ✅

**Does NOT match:**

- `func GetArticle` (Go) ✗ `function getArticle` (TS)
- `func getArticle` (Go) ✗ `export function getArticle` (TS)

## Matching Priority

When multiple candidate functions exist, the extension prioritizes matches in this order:

1. **Accessibility Match** (Highest Priority)
   - Same export/public visibility

2. **Exact Name Match**
   - Function name is identical (no case conversion needed)

3. **Any Match** (Lowest Priority)
   - Function name matches after case conversion

## Requirements

- VSCode version 1.97.0 or higher
- Go VSCode extension
- TypeScript VSCode language support

## Supported Languages

- Go (`.go`)
- TypeScript (`.ts`)
- TypeScript React (`.tsx`)

## License

MIT

## Repository

[https://github.com/ayonli/bilingo-vscode](https://github.com/ayonli/bilingo-vscode)

## Issues

Report issues at: [https://github.com/ayonli/bilingo-vscode/issues](https://github.com/ayonli/bilingo-vscode/issues)
