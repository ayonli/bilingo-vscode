# Bilingo VSCode Extension

Find function and type references between Go and TypeScript in bilingual projects (Bilingo = **Bilin**gual + **Go**).

## Features

- **Cross-Language Reference Finding**: Seamlessly find references between Go and TypeScript functions,
  types, enum constants, and struct fields/interface properties.
- **Cross-Language Implementation Finding**: Find corresponding declarations across languages
  - Go functions ↔ TypeScript function declarations
  - Go structs ↔ TypeScript interfaces (+ TypeScript implementations)
- **Type Matching**: Go structs ↔ TypeScript interfaces and enum constants (perfect for
  [tygo](https://github.com/gzuidhof/tygo)-generated code)
- **Native Integration**: Works directly with VSCode's built-in "Find All References" (`Shift+F12`) and "Find All Implementations" (`Ctrl+F12`) features
- **Smart Name Matching**: Automatically handles case conversion (PascalCase ↔ camelCase)
- **Accessibility Matching**: Optional strict mode to match exported/unexported symbols

## Rules

- **Same-Directory Scope**: Go and TypeScript symbols must be declared in the same directory
- **Top-Level Functions Only**: Only match top-level functions, excludes struct/class methods and nested functions
- **Exported Types Only**: Only match exported Go structs (capitalized) and exported TypeScript interfaces

## Usage

### Find All References

Simply use the native "Find All References" feature (right-click → "Find All References" or press
`Shift+F12`) on any function or type name in Go or TypeScript files. The extension will automatically find
references in both languages.

### Find All Implementations

Use the native "Find All Implementations" feature (right-click → "Go to Implementations" or press
`Ctrl+F12` / `Cmd+F12`) on functions, structs, or interfaces in Go or TypeScript files. The extension will
automatically find corresponding declarations and implementations in both languages.

### Example: Function Matching

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

Along with all locations where the function is used.

### Example: Type Matching

When you trigger "Find All References" on a Go struct:

```go
// types/article.go
type Article struct {
    ID    string
    Title string
}
```

The extension will find the corresponding TypeScript interface in the same directory:

```typescript
// types/article.ts
export interface Article {
    ID: string
    Title: string
}
```

Along with all locations where the interface or it's properties are used.

This is especially useful for projects using [tygo](https://github.com/gzuidhof/tygo) to generate TypeScript types from Go structs.

### Example: Enum Constant Matching

When you trigger "Find All References" on a Go constant:

```go
// config/status.go
type Status = string

const (
    StatusActive   Status = "active"
    StatusInactive Status = "inactive"
)
```

The extension will find the corresponding TypeScript constant in the same directory:

```typescript
// config/status.ts
export const StatusActive = "active"
export const StatusInactive = "inactive"
export type Status = typeof StatusActive | typeof StatusInactive
```

Along with all locations where these constants are used in both languages.

### Example: Go Struct → TypeScript Interface → Implementations

When you trigger "Find All Implementations" on a Go struct:

```go
// types/user.go
type User struct {  // ← Trigger here
    ID   string
    Name string
}
```

```typescript
// types/user.ts
export interface User { // ← Found: TS interface
    id: string
    name: string
}

// somewhere-else.ts
export const user: User = { // ← Found: TS implementations
    id: "johndoe",
    name: "John Doe",
}
```

### Example: Function Implementations

When you trigger "Find All Implementations" on a function:

```typescript
// api/article.ts
export function getArticle(id: string): Article { // ← Trigger here
    // ...
}
```

```go
// api/article.go
func GetArticle(id string) Article {  // ← Found
    // ...
}
```

And many more.

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

When enabled, only matches symbols with the same accessibility:

- Go **capitalized** symbols ↔ TypeScript **export**ed symbols
- Go **non-capitalized** functions ↔ TypeScript **non-exported** functions (Note: structs and interfaces are always exported)

```json
{
    "bilingo-vscode.strictAccessibility": true
}
```

#### Example with Strict Accessibility

**Functions - Matches:**

- `func GetArticle` (Go) ↔ `export function getArticle` (TS) ✅
- `func getArticle` (Go) ↔ `function getArticle` (TS) ✅

**Functions - Does NOT match:**

- `func GetArticle` (Go) ✗ `function getArticle` (TS)
- `func getArticle` (Go) ✗ `export function getArticle` (TS)

**Types - Always match exported only:**

- `type Article struct` (Go) ↔ `export interface Article` (TS) ✅
- `type article struct` (Go - not exported) ✗ Any TypeScript interface
- Any Go struct ✗ `interface Article` (TS - not exported)

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
