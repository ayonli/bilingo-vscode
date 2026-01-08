import * as vscode from "vscode"
import * as path from "node:path"

/**
 * Get the symbol name at the given position.
 * This can be used for function/struct/interface lookups.
 * This can be either:
 * 1. A symbol being referenced (e.g., cursor on "getArticle" in "getArticle()").
 * 2. A symbol declaration (e.g., cursor on symbol name in "function getArticle()").
 */
export function getSymbolNameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    // First, try to get the identifier at the exact cursor position
    const wordRange = document.getWordRangeAtPosition(position)
    if (wordRange) {
        const word = document.getText(wordRange)
        // Verify this is actually a symbol name (not a keyword, etc.)
        if (word && /^[a-zA-Z_]\w*$/.test(word)) {
            return word
        }
    }

    // Fallback: try to extract symbol name from text pattern matching
    return extractFunctionNameFromText(document, position)
}

/**
 * @deprecated Use getSymbolNameAtPosition instead
 */
export function getFunctionNameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    return getSymbolNameAtPosition(document, position)
}

/**
 * Extract function name from text at position (fallback method).
 */
function extractFunctionNameFromText(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    const line = document.lineAt(position.line).text
    const offset = position.character

    // Try to find a word at the cursor position
    const wordRange = document.getWordRangeAtPosition(position)
    if (wordRange) {
        return document.getText(wordRange)
    }

    // Try to match function patterns
    // TypeScript: function name( or const name = ( or async function name(
    const tsFuncPattern =
        /\b(?:export\s+)?(?:async\s+)?(?:function\s+)?(\w+)\s*[=:]?\s*(?:async\s+)?\(/g
    // Go: func name( or func (receiver) name(
    const goFuncPattern = /\bfunc\s+(?:\([^)]*\)\s+)?(\w+)\s*\(/g

    let match
    const patterns = [tsFuncPattern, goFuncPattern]

    for (const pattern of patterns) {
        pattern.lastIndex = 0
        while ((match = pattern.exec(line)) !== null) {
            const nameStart = match.index + match[0].indexOf(match[1])
            const nameEnd = nameStart + match[1].length

            if (offset >= nameStart && offset <= nameEnd) {
                return match[1]
            }
        }
    }

    return null
}

/**
 * Capitalize the first letter of a string.
 */
export function capitalizeFirstLetter(str: string): string {
    if (!str) { return str }
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Lowercase the first letter of a string.
 */
export function lowercaseFirstLetter(str: string): string {
    if (!str) { return str }
    return str.charAt(0).toLowerCase() + str.slice(1)
}

/**
 * Check if a Go symbol name is exported (starts with uppercase letter).
 */
export function isGoSymbolExported(symbolName: string): boolean {
    if (!symbolName) { return false }
    const firstChar = symbolName[0]
    return firstChar === firstChar.toUpperCase()
}

/**
 * Find all Go files in the same directory as the given file.
 */
export async function findGoFilesInSameDirectory(fileUri: vscode.Uri): Promise<vscode.Uri[]> {
    const dirPath = path.dirname(fileUri.fsPath)

    const pattern = new vscode.RelativePattern(dirPath, "*.go")
    const files = await vscode.workspace.findFiles(pattern)

    return files
}

/**
 * Find all TypeScript files in the same directory as the given file.
 */
export async function findTsFilesInSameDirectory(fileUri: vscode.Uri): Promise<vscode.Uri[]> {
    const dirPath = path.dirname(fileUri.fsPath)

    const pattern = new vscode.RelativePattern(dirPath, "*.{ts,tsx}")
    const files = await vscode.workspace.findFiles(pattern)

    return files
}

/**
 * Check if a symbol is exported.
 */
export async function isSymbolExported(
    fileUri: vscode.Uri,
    position: vscode.Position,
    symbolName: string,
    languageId: string,
    symbolKind?: vscode.SymbolKind,
): Promise<boolean> {
    if (languageId === "go") {
        // In Go, exported symbols start with uppercase letter
        return isGoSymbolExported(symbolName)
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        // In TypeScript, check if the symbol has 'export' keyword
        const document = await vscode.workspace.openTextDocument(fileUri)
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            fileUri,
        )

        if (!symbols) {
            return false
        }

        // Find the symbol
        for (const symbol of symbols) {
            // If symbolKind is provided, check it; otherwise just match by name
            if (
                (!symbolKind || symbol.kind === symbolKind) &&
                symbol.name === symbolName &&
                symbol.range.contains(position)
            ) {
                // Check if the line contains 'export' keyword
                const line = document.lineAt(symbol.range.start.line).text
                return /^\s*export\s+/.test(line)
            }
        }
    }

    return false
}

export interface DeclarationInfo {
    location: vscode.Location
    kind: vscode.SymbolKind
}

/**
 * Recursively find a symbol (function/struct/interface) whose selectionRange contains the position.
 * This finds the declaration, not usages.
 */
function findSymbolAtLocation(
    symbols: vscode.DocumentSymbol[],
    position: vscode.Position,
): vscode.DocumentSymbol | null {
    for (const symbol of symbols) {
        // Check if this is a function, struct, or interface
        // and the position is within its selectionRange (the symbol name itself)
        if (
            (symbol.kind === vscode.SymbolKind.Function ||
                symbol.kind === vscode.SymbolKind.Struct ||
                symbol.kind === vscode.SymbolKind.Interface) &&
            symbol.selectionRange.contains(position)
        ) {
            return symbol
        }

        // Recursively search in children
        if (symbol.children && symbol.children.length > 0) {
            const found = findSymbolAtLocation(symbol.children, position)
            if (found) {
                return found
            }
        }
    }

    return null
}

/**
 * Find the symbol declaration location using reference provider
 * (for functions, structs, or interfaces).
 * Uses vscode.executeReferenceProvider which is safe due to global recursion guard.
 */
export async function findDeclarationLocationViaReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbolName: string,
): Promise<DeclarationInfo | null> {
    try {
        // Use reference provider to find all references (including declaration)
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            document.uri,
            position,
        )

        if (!references || references.length === 0) {
            return null
        }

        // Find the declaration from references
        for (const ref of references) {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                ref.uri,
            )

            if (!symbols) {
                continue
            }

            // Look for a symbol whose selectionRange (name location) matches this reference
            // This identifies the declaration, not a usage
            const declaration = findSymbolAtLocation(symbols, ref.range.start)
            if (declaration && declaration.name === symbolName) {
                return {
                    location: new vscode.Location(ref.uri, declaration.selectionRange.start),
                    kind: declaration.kind,
                }
            }
        }

        // If no declaration found, use the first reference (assume function)
        return {
            location: references[0],
            kind: vscode.SymbolKind.Function,
        }
    } catch (error) {
        console.error("Error finding declaration location:", error)
        return null
    }
}

/**
 * Find the symbol declaration location using definition provider
 * (for interfaces primarily).
 */
export async function findDeclarationLocationViaDefinition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbolName: string,
    targetKind?: vscode.SymbolKind,
): Promise<DeclarationInfo | null> {
    try {
        // Use definition provider to find the declaration
        const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeDefinitionProvider",
            document.uri,
            position,
        )

        if (!definitions || definitions.length === 0) {
            return null
        }

        // Get the first definition
        const def = definitions[0]

        // Get symbols to determine kind
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            def.uri,
        )

        if (!symbols) {
            return null
        }

        // Look for the target symbol
        for (const symbol of symbols) {
            if (
                (!targetKind || symbol.kind === targetKind) &&
                symbol.name === symbolName &&
                symbol.range.contains(def.range.start)
            ) {
                return {
                    location: new vscode.Location(def.uri, symbol.selectionRange.start),
                    kind: symbol.kind,
                }
            }
        }

        return null
    } catch (error) {
        console.error("Error finding declaration location:", error)
        return null
    }
}

/**
 * Symbol match candidate with score.
 */
export interface SymbolCandidate {
    symbol: vscode.DocumentSymbol
    fileUri: vscode.Uri
    score: number // Higher is better: 3 = accessibility + exact name (best), 2 = accessibility match, 1 = exact name match, 0 = any match
}

/**
 * Calculate match score for a symbol candidate.
 * Higher score is better: 3 = accessibility + exact name (best), 2 = accessibility match, 1 = exact name match, 0 = any match.
 */
function calculateMatchScore(
    symbolName: string,
    targetNames: string[],
    isSymbolExported: boolean,
    isSourceExported: boolean,
): number {
    const exactName = symbolName === targetNames[0]
    const sameAccessibility = isSourceExported === isSymbolExported

    if (sameAccessibility && exactName) {
        return 3 // Best: both match
    } else if (sameAccessibility) {
        return 2 // Good: accessibility matches
    } else if (exactName) {
        return 1 // OK: name matches
    } else {
        return 0 // Fallback: some match
    }
}

/**
 * Find matching symbols in Go files.
 * Routes to specialized functions based on symbol kind.
 */
export async function findMatchingSymbolsInGoFiles(
    goFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
    strictAccessibility: boolean,
): Promise<SymbolCandidate[]> {
    // Route to specialized functions based on symbol kind
    if (symbolKind === vscode.SymbolKind.Function) {
        // TS function -> Go function
        return await findGoFunctionForTsFunctionViaMatching(
            goFiles,
            symbolNames,
            isSourceExported,
            strictAccessibility,
        )
    } else if (symbolKind === vscode.SymbolKind.Interface) {
        // TS interface -> Go struct
        return await findGoStructForTsInterfaceViaMatching(
            goFiles,
            symbolNames,
        )
    }

    // No matching function for this symbol kind
    return []
}

/**
 * Find Go function for TypeScript function (via matching).
 * This is used by the reference finder for TS function -> Go function lookups.
 */
async function findGoFunctionForTsFunctionViaMatching(
    goFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    strictAccessibility: boolean,
): Promise<SymbolCandidate[]> {
    const candidates: SymbolCandidate[] = []

    for (const fileUri of goFiles) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                fileUri,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                // TS function -> Go function
                if (
                    symbol.kind === vscode.SymbolKind.Function &&
                    symbolNames.includes(symbol.name) &&
                    isTopLevelFunction(symbol, symbols)
                ) {
                    const isGoExported = isGoSymbolExported(symbol.name)

                    // Check accessibility if strict mode is enabled
                    if (strictAccessibility && isSourceExported !== isGoExported) {
                        continue
                    }

                    // Calculate match score
                    const score = calculateMatchScore(
                        symbol.name,
                        symbolNames,
                        isGoExported,
                        isSourceExported,
                    )

                    candidates.push({ symbol, fileUri, score })
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${fileUri.fsPath}:`, error)
        }
    }

    // Sort by score (higher is better)
    candidates.sort((a, b) => b.score - a.score)

    return candidates
}

/**
 * Find Go struct for TypeScript interface (via matching).
 * This is used by the reference finder for TS interface -> Go struct lookups.
 */
async function findGoStructForTsInterfaceViaMatching(
    goFiles: vscode.Uri[],
    symbolNames: string[],
): Promise<SymbolCandidate[]> {
    const candidates: SymbolCandidate[] = []

    for (const fileUri of goFiles) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                fileUri,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                // TS interface -> Go struct
                if (
                    symbol.kind === vscode.SymbolKind.Struct &&
                    symbolNames.includes(symbol.name)
                ) {
                    const isGoExported = isGoSymbolExported(symbol.name)

                    // Only match exported structs
                    if (!isGoExported) {
                        continue
                    }

                    // Exact name match
                    const score = symbolNames[0] === symbol.name ? 100 : 90

                    candidates.push({ symbol, fileUri, score })
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${fileUri.fsPath}:`, error)
        }
    }

    // Sort by score (higher is better)
    candidates.sort((a, b) => b.score - a.score)

    return candidates
}

/**
 * Find matching symbols in TypeScript files.
 * Routes to specialized functions based on symbol kind.
 */
export async function findMatchingSymbolsInTsFiles(
    tsFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
    strictAccessibility: boolean,
): Promise<SymbolCandidate[]> {
    // Route to specialized functions based on symbol kind
    if (symbolKind === vscode.SymbolKind.Function) {
        // Go function -> TS function
        return await findTsFunctionForGoFunctionViaMatching(
            tsFiles,
            symbolNames,
            isSourceExported,
            strictAccessibility,
        )
    } else if (symbolKind === vscode.SymbolKind.Struct) {
        // Go struct -> TS interface
        return await findTsInterfaceForGoStructViaMatching(
            tsFiles,
            symbolNames,
        )
    }

    // No matching function for this symbol kind
    return []
}

/**
 * Find TypeScript function for Go function (via matching).
 * This is used by the reference finder for Go function -> TS function lookups.
 */
async function findTsFunctionForGoFunctionViaMatching(
    tsFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    strictAccessibility: boolean,
): Promise<SymbolCandidate[]> {
    // Open all TypeScript files to ensure language server is ready
    await Promise.all(
        tsFiles.map((fileUri) => vscode.workspace.openTextDocument(fileUri)),
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    const candidates: SymbolCandidate[] = []

    for (const fileUri of tsFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                fileUri,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                // Go function -> TS function
                if (
                    symbol.kind === vscode.SymbolKind.Function &&
                    symbolNames.includes(symbol.name) &&
                    isTopLevelFunction(symbol, symbols)
                ) {
                    // Check if TypeScript symbol is exported
                    const line = document.lineAt(symbol.range.start.line).text
                    const isTsExported = /^\s*export\s+/.test(line)

                    // Check accessibility if strict mode is enabled
                    if (strictAccessibility && isSourceExported !== isTsExported) {
                        continue
                    }

                    // Calculate match score
                    const score = calculateMatchScore(
                        symbol.name,
                        symbolNames,
                        isTsExported,
                        isSourceExported,
                    )

                    candidates.push({ symbol, fileUri, score })
                }
            }
        } catch (error) {
            console.error(`Error processing TypeScript file ${fileUri.fsPath}:`, error)
        }
    }

    // Sort by score (higher is better)
    candidates.sort((a, b) => b.score - a.score)

    return candidates
}

/**
 * Find TypeScript interface for Go struct (via matching).
 * This is used by the reference finder for Go struct -> TS interface lookups.
 */
async function findTsInterfaceForGoStructViaMatching(
    tsFiles: vscode.Uri[],
    symbolNames: string[],
): Promise<SymbolCandidate[]> {
    // Open all TypeScript files to ensure language server is ready
    await Promise.all(
        tsFiles.map((fileUri) => vscode.workspace.openTextDocument(fileUri)),
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    const candidates: SymbolCandidate[] = []

    for (const fileUri of tsFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(fileUri)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                fileUri,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                // Go struct -> TS interface
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    symbolNames.includes(symbol.name)
                ) {
                    // Check if TypeScript symbol is exported
                    const line = document.lineAt(symbol.range.start.line).text
                    const isTsExported = /^\s*export\s+/.test(line)

                    // Only match exported interfaces
                    if (!isTsExported) {
                        continue
                    }

                    // Exact name match
                    const score = symbolNames[0] === symbol.name ? 100 : 90

                    candidates.push({ symbol, fileUri, score })
                }
            }
        } catch (error) {
            console.error(`Error processing TypeScript file ${fileUri.fsPath}:`, error)
        }
    }

    // Sort by score (higher is better)
    candidates.sort((a, b) => b.score - a.score)

    return candidates
}

/**
 * Check if a symbol is a top-level function.
 */
export function isTopLevelFunction(
    symbol: vscode.DocumentSymbol,
    allSymbols: vscode.DocumentSymbol[],
): boolean {
    if (symbol.kind !== vscode.SymbolKind.Function) {
        return false
    }

    for (const parentSymbol of allSymbols) {
        if (parentSymbol === symbol) {
            continue
        }

        if (parentSymbol.kind === vscode.SymbolKind.Function) {
            if (isSymbolNested(symbol, parentSymbol)) {
                return false
            }
        }

        if (parentSymbol.children && parentSymbol.children.length > 0) {
            for (const child of parentSymbol.children) {
                if (child.kind === vscode.SymbolKind.Function && isSymbolNested(symbol, child)) {
                    return false
                }
            }
        }
    }

    return true
}

/**
 * Check if a symbol is nested inside another symbol.
 */
export function isSymbolNested(
    symbol: vscode.DocumentSymbol,
    parent: vscode.DocumentSymbol,
): boolean {
    return parent.range.contains(symbol.range) && !parent.range.isEqual(symbol.range)
}

/**
 * Enum constant information.
 */
export interface EnumConstInfo {
    name: string // Constant name
    constSymbol: vscode.DocumentSymbol // The constant symbol itself
    fileUri: vscode.Uri
    isExported: boolean // Whether the constant is exported
}

/**
 * Enum type information.
 */
export interface EnumTypeInfo {
    name: string // Type name
    typeSymbol: vscode.DocumentSymbol // The type symbol itself
    fileUri: vscode.Uri
    isExported: boolean // Whether the type is exported
}

/**
 * Field or property information.
 */
export interface FieldInfo {
    name: string // Field/property name
    jsonTag?: string // JSON tag (for Go structs)
    parentSymbol: vscode.DocumentSymbol // Parent struct or interface
    fieldSymbol: vscode.DocumentSymbol // The field/property symbol itself
    fileUri: vscode.Uri
}

/**
 * Interface method information.
 */
export interface InterfaceMethodInfo {
    name: string // Method name
    parentSymbol: vscode.DocumentSymbol // Parent interface
    methodSymbol: vscode.DocumentSymbol // The method symbol itself
    fileUri: vscode.Uri
    isExported: boolean // Whether the method is exported
}

/**
 * Interface information (for the interface itself, not its members).
 */
export interface InterfaceInfo {
    name: string // Interface name
    symbol: vscode.DocumentSymbol // The interface symbol itself
    fileUri: vscode.Uri
    isExported: boolean // Whether the interface is exported
    hasMethods: boolean // Whether the interface has methods (true) or only properties (false)
}

/**
 * Symbol information (for function/struct/interface lookup in references).
 */
export interface SymbolInfo {
    name: string // Symbol name
    kind: vscode.SymbolKind // Symbol kind (Function/Struct/Interface)
    location: vscode.Location // Declaration location
    isExported: boolean // Whether the symbol is exported
}

/**
 * Get the constant at the given position.
 * Returns constant info if cursor is on a constant (Go const with uppercase first letter, or TS export const with uppercase first letter).
 * Works both at definition site and usage site.
 */
export async function getEnumConstInfoAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<EnumConstInfo | null> {
    const languageId = document.languageId

    // Get document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
    )

    if (!symbols) {
        return null
    }

    // First, try to find constant at definition position
    let constInfo: EnumConstInfo | null = null

    if (languageId === "go") {
        constInfo = findGoEnumConstAtPosition(document, position, symbols)
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        constInfo = findTsEnumConstAtPosition(document, position, symbols)
    }

    // If found at definition, return it
    if (constInfo) {
        return constInfo
    }

    // Otherwise, try to find constant at usage position
    return await findEnumConstAtUsagePosition(document, position)
}

/**
 * Get the enum type at the given position.
 * Returns type info if cursor is on an enum type (Go type alias or TS export type).
 * Works both at definition site and usage site.
 */
export async function getEnumTypeInfoAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<EnumTypeInfo | null> {
    const languageId = document.languageId

    // Get document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
    )

    if (!symbols) {
        return null
    }

    // Try to find type at definition position
    let typeInfo: EnumTypeInfo | null = null

    if (languageId === "go") {
        typeInfo = findGoEnumTypeAtPosition(document, position, symbols)
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        typeInfo = findTsEnumTypeAtPosition(document, position, symbols)
    }

    // If found at definition, return it
    if (typeInfo) {
        return typeInfo
    }

    // Otherwise, try to find type at usage position
    const usageTypeInfo = await findEnumTypeAtUsagePosition(document, position)
    return usageTypeInfo
}

/**
 * Find constant at usage position.
 * Uses definition provider to locate the constant definition.
 */
async function findEnumConstAtUsagePosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<EnumConstInfo | null> {
    try {
        // Get the word at cursor (should be the constant name)
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return null
        }

        const word = document.getText(wordRange)

        // Check if the word starts with uppercase (required for constants)
        if (!word || word[0] !== word[0].toUpperCase()) {
            return null
        }

        // Check if the word has at least 2 uppercase letters
        if (!hasAtLeastTwoUppercaseLetters(word)) {
            return null
        }

        // Use definition provider to find the constant definition
        const definitions = await vscode.commands.executeCommand<
            (vscode.Location | vscode.LocationLink)[]
        >(
            "vscode.executeDefinitionProvider",
            document.uri,
            position,
        )

        if (!definitions || definitions.length === 0) {
            return null
        }

        // Get the first definition
        const definition = definitions[0]
        let defUri: vscode.Uri
        let defPosition: vscode.Position

        if ("targetUri" in definition) {
            // LocationLink
            defUri = definition.targetUri
            defPosition = definition.targetRange.start
        } else {
            // Location
            defUri = definition.uri
            defPosition = definition.range.start
        }

        // Open the definition document
        const defDocument = await vscode.workspace.openTextDocument(defUri)
        const defLanguageId = defDocument.languageId

        // Get symbols from the definition document
        const defSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            defUri,
        )

        if (!defSymbols) {
            return null
        }

        // Find the constant info at the definition position
        if (defLanguageId === "go") {
            return findGoEnumConstByNameAndLine(
                defDocument,
                word,
                defPosition.line,
                defSymbols,
            )
        } else if (defLanguageId === "typescript" || defLanguageId === "typescriptreact") {
            return findTsEnumConstByNameAndLine(
                defDocument,
                word,
                defPosition.line,
                defSymbols,
            )
        }
    } catch (error) {
        console.error("Error finding constant at usage position:", error)
    }

    return null
}

/**
 * Check if a constant name has at least 2 uppercase letters.
 */
function hasAtLeastTwoUppercaseLetters(name: string): boolean {
    const uppercaseCount = (name.match(/[A-Z]/g) || []).length
    return uppercaseCount >= 2
}

/**
 * Check if a line contains a literal value (string, number, or boolean).
 */
function hasLiteralValue(line: string): boolean {
    const hasStringLiteral = /"[^"]*"/.test(line) || /'[^']*'/.test(line) || /`[^`]*`/.test(line)
    const hasNumberLiteral = /=\s*-?\d+\b/.test(line)
    const hasBooleanLiteral = /=\s*(true|false)\b/.test(line)
    return hasStringLiteral || hasNumberLiteral || hasBooleanLiteral
}

/**
 * Check if a line contains a literal type annotation (string, number, or boolean).
 */
function hasLiteralType(line: string): boolean {
    return /:\s*(["'`])[^"'`]*\1|:\s*-?\d+\b|:\s*(true|false)\b/.test(line)
}

/**
 * Check if the symbol is a Go enum constant.
 */
export function isGoEnumConst(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
): boolean {
    try {
        // Get the line where the constant is declared
        const line = document.lineAt(symbol.range.start.line).text
        const constName = symbol.name

        // For enum constants, we require explicit type annotation
        // Pattern: ConstName TypeName = value
        // `const` keyword is optional since the constant may be part of a const block
        const constMatch = line.match(/\s+(\w+)\s+(\w+)\s*=/)
        if (!constMatch) {
            // No explicit type annotation - not an enum constant
            return false
        }

        const typeName = constMatch[2]
        if (
            !/^[A-Z]/.test(constName) || // Const name must be capitalized
            !/^[A-Z]/.test(typeName) || // Type name must be capitalized
            !constName.startsWith(typeName) || // Const name must start with type name
            !hasAtLeastTwoUppercaseLetters(constName) || // Const name must have at least 2 uppercase letters
            !hasLiteralValue(line) // Value must be a literal
        ) {
            return false
        }

        return true
    } catch (error) {
        console.error("Error checking Go enum constant type:", error)
        return false
    }
}

/**
 * Check if TypeScript enum constant has valid type (string or number literal).
 */
export function isTsEnumConst(
    document: vscode.TextDocument,
    symbol: vscode.DocumentSymbol,
): boolean {
    try {
        // Get the line where the constant is declared
        const line = document.lineAt(symbol.range.start.line).text
        const constName = symbol.name

        if (
            !/^\s*export\s+const\s+/.test(line) || // Const must be exported
            !/^[A-Z]/.test(constName) || // Const name must be capitalized
            !hasAtLeastTwoUppercaseLetters(constName) || // Const name must have at least 2 uppercase letters
            (!hasLiteralValue(line) && !hasLiteralType(line)) // Value or type must be a literal
        ) {
            return false
        }

        return true
    } catch (error) {
        console.error("Error checking TS enum constant type:", error)
        return false
    }
}

/**
 * Find Go constant at position.
 * Only matches constants with uppercase first letter (exported).
 */
function findGoEnumConstAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): EnumConstInfo | null {
    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Constant) {
            // Check if position is within the constant's range
            if (
                symbol.selectionRange.contains(position) ||
                symbol.range.contains(position)
            ) {
                // Check if the constant is a enum constant
                if (!isGoEnumConst(document, symbol)) {
                    continue
                }

                return {
                    name: symbol.name,
                    constSymbol: symbol,
                    fileUri: document.uri,
                    isExported: true, // Go constants with uppercase are exported
                }
            }
        }
    }

    return null
}

/**
 * Find Go constant by name and line number.
 * Used when definition provider returns a position that's not exactly on the symbol.
 */
function findGoEnumConstByNameAndLine(
    document: vscode.TextDocument,
    constName: string,
    line: number,
    symbols: vscode.DocumentSymbol[],
): EnumConstInfo | null {
    for (const symbol of symbols) {
        if (
            symbol.kind === vscode.SymbolKind.Constant &&
            symbol.name === constName &&
            symbol.range.start.line === line
        ) {
            // Check if the constant is a enum constant
            if (!isGoEnumConst(document, symbol)) {
                continue
            }

            return {
                name: symbol.name,
                constSymbol: symbol,
                fileUri: document.uri,
                isExported: true,
            }
        }
    }

    return null
}

/**
 * Find TypeScript constant at position.
 * Only matches export const with uppercase first letter.
 */
function findTsEnumConstAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): EnumConstInfo | null {
    for (const symbol of symbols) {
        if (
            symbol.kind === vscode.SymbolKind.Constant ||
            symbol.kind === vscode.SymbolKind.Variable
        ) {
            // Check if position is within the constant's range
            if (
                symbol.selectionRange.contains(position) ||
                symbol.range.contains(position)
            ) {
                // Check if the constant has a valid type
                if (!isTsEnumConst(document, symbol)) {
                    continue
                }

                return {
                    name: symbol.name,
                    constSymbol: symbol,
                    fileUri: document.uri,
                    isExported: true,
                }
            }
        }
    }

    return null
}

/**
 * Find TypeScript constant by name and line number.
 * Used when definition provider returns a position that's not exactly on the symbol.
 */
function findTsEnumConstByNameAndLine(
    document: vscode.TextDocument,
    constName: string,
    line: number,
    symbols: vscode.DocumentSymbol[],
): EnumConstInfo | null {
    for (const symbol of symbols) {
        if (
            (symbol.kind === vscode.SymbolKind.Constant ||
                symbol.kind === vscode.SymbolKind.Variable) &&
            symbol.name === constName &&
            symbol.range.start.line === line
        ) {
            // Check if the constant has a valid type
            if (!isTsEnumConst(document, symbol)) {
                continue
            }

            return {
                name: symbol.name,
                constSymbol: symbol,
                fileUri: document.uri,
                isExported: true,
            }
        }
    }

    return null
}

/**
 * Find Go enum type at position.
 */
function findGoEnumTypeAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): EnumTypeInfo | null {
    for (const symbol of symbols) {
        if (
            symbol.kind === vscode.SymbolKind.Class || symbol.kind === vscode.SymbolKind.Interface
        ) {
            // Check if position is within the type's range
            if (
                symbol.selectionRange.contains(position) ||
                symbol.range.contains(position)
            ) {
                // Verify it's a type alias (type Status = string/int/bool/etc)
                const line = document.lineAt(symbol.range.start.line).text

                if (
                    /type\s+\w+\s*=\s*(string|int\d*|uint\d*|float\d+|bool|byte|rune)/.test(line) &&
                    /^[A-Z]/.test(symbol.name)
                ) {
                    return {
                        name: symbol.name,
                        typeSymbol: symbol,
                        fileUri: document.uri,
                        isExported: true,
                    }
                }
            }
        }
    }

    return null
}

/**
 * Find TypeScript enum type at position.
 */
function findTsEnumTypeAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): EnumTypeInfo | null {
    // Check the line at the cursor position
    const line = document.lineAt(position.line).text

    // First, check if it's an export type definition
    const typeNameMatch = line.match(/export\s+type\s+(\w+)\s*=/)
    if (!typeNameMatch) {
        return null
    }

    const typeName = typeNameMatch[1]

    // Check if the type definition contains typeof pattern
    // It could be on the same line or the next line (code formatter behavior)
    let foundTypeofPattern = false
    const typeofPattern = new RegExp(`typeof\\s+${typeName}[A-Z]`)

    // Check current line first
    if (typeofPattern.test(line)) {
        foundTypeofPattern = true
    } else if (position.line + 1 < document.lineCount) {
        // Check next line - formatter might put union types on next line
        // Could be: | typeof ... or typeof ... |
        const nextLine = document.lineAt(position.line + 1).text
        if (typeofPattern.test(nextLine) && (/^\s*\|/.test(nextLine) || /\|\s*$/.test(nextLine))) {
            foundTypeofPattern = true
        }
    }

    if (!foundTypeofPattern) {
        return null
    }

    // Find the corresponding symbol for this type
    for (const symbol of symbols) {
        if (symbol.name === typeName) {
            return {
                name: symbol.name,
                typeSymbol: symbol,
                fileUri: document.uri,
                isExported: true,
            }
        }
    }

    // Create synthetic symbol if not found in symbol tree
    const lineRange = document.lineAt(position.line).range
    const syntheticSymbol: vscode.DocumentSymbol = {
        name: typeName,
        detail: "",
        kind: vscode.SymbolKind.Class,
        range: lineRange,
        selectionRange: lineRange,
        children: [],
    }

    return {
        name: typeName,
        typeSymbol: syntheticSymbol,
        fileUri: document.uri,
        isExported: true,
    }
}

/**
 * Find enum type at usage position.
 */
async function findEnumTypeAtUsagePosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<EnumTypeInfo | null> {
    try {
        // Get the word at cursor
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return null
        }

        const word = document.getText(wordRange)

        // Check if starts with uppercase
        if (!word || word[0] !== word[0].toUpperCase()) {
            return null
        }

        // Use definition provider to find the type definition
        const definitions = await vscode.commands.executeCommand<
            (vscode.Location | vscode.LocationLink)[]
        >(
            "vscode.executeDefinitionProvider",
            document.uri,
            position,
        )

        if (!definitions || definitions.length === 0) {
            return null
        }

        // Get the first definition
        const definition = definitions[0]
        let defUri: vscode.Uri
        let defPosition: vscode.Position

        if ("targetUri" in definition) {
            defUri = definition.targetUri
            defPosition = definition.targetRange.start
        } else {
            defUri = definition.uri
            defPosition = definition.range.start
        }

        // Open the definition document
        const defDocument = await vscode.workspace.openTextDocument(defUri)
        const defLanguageId = defDocument.languageId

        // Get symbols from the definition document
        const defSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            defUri,
        )

        if (!defSymbols) {
            return null
        }

        // Find the type info at the definition position
        if (defLanguageId === "go") {
            return findGoEnumTypeByNameAndLine(defDocument, word, defPosition.line, defSymbols)
        } else if (defLanguageId === "typescript" || defLanguageId === "typescriptreact") {
            return findTsEnumTypeByNameAndLine(defDocument, word, defPosition.line, defSymbols)
        }
    } catch (error) {
        console.error("Error finding type at usage position:", error)
    }

    return null
}

/**
 * Find Go enum type by name and line number.
 */
function findGoEnumTypeByNameAndLine(
    document: vscode.TextDocument,
    typeName: string,
    line: number,
    symbols: vscode.DocumentSymbol[],
): EnumTypeInfo | null {
    for (const symbol of symbols) {
        if (
            (symbol.kind === vscode.SymbolKind.Class ||
                symbol.kind === vscode.SymbolKind.Interface) &&
            symbol.name === typeName &&
            symbol.range.start.line === line
        ) {
            // Verify it's a type alias (type Status = string/int/bool/etc)
            const lineText = document.lineAt(symbol.range.start.line).text

            if (
                /type\s+\w+\s*=\s*(string|int\d*|uint\d*|float\d+|bool|byte|rune)/.test(lineText) &&
                /^[A-Z]/.test(symbol.name)
            ) {
                return {
                    name: symbol.name,
                    typeSymbol: symbol,
                    fileUri: document.uri,
                    isExported: true,
                }
            }
        }
    }

    return null
}

/**
 * Find TypeScript enum type by name and line number.
 */
function findTsEnumTypeByNameAndLine(
    document: vscode.TextDocument,
    typeName: string,
    line: number,
    symbols: vscode.DocumentSymbol[],
): EnumTypeInfo | null {
    // Check the line content
    const lineText = document.lineAt(line).text

    // Check if it's an export type definition
    const typeNameMatch = lineText.match(new RegExp(`export\\s+type\\s+${typeName}\\s*=`))
    if (!typeNameMatch) {
        return null
    }

    // Check if the type definition contains typeof pattern (could be on next line)
    let foundTypeofPattern = false
    const typeofPattern = new RegExp(`typeof\\s+${typeName}[A-Z]`)

    // Check current line first
    if (typeofPattern.test(lineText)) {
        foundTypeofPattern = true
    } else if (line + 1 < document.lineCount) {
        // Check next line - formatter might put union types on next line
        // Could be: | typeof ... or typeof ... |
        const nextLine = document.lineAt(line + 1).text
        if (typeofPattern.test(nextLine) && (/^\s*\|/.test(nextLine) || /\|\s*$/.test(nextLine))) {
            foundTypeofPattern = true
        }
    }

    if (!foundTypeofPattern) {
        return null
    }

    // Try to find actual symbol first
    for (const symbol of symbols) {
        if (symbol.name === typeName && symbol.range.start.line === line) {
            return {
                name: symbol.name,
                typeSymbol: symbol,
                fileUri: document.uri,
                isExported: true,
            }
        }
    }

    // Create synthetic symbol if not found
    const lineRange = document.lineAt(line).range
    const syntheticSymbol: vscode.DocumentSymbol = {
        name: typeName,
        detail: "",
        kind: vscode.SymbolKind.Class,
        range: lineRange,
        selectionRange: lineRange,
        children: [],
    }

    return {
        name: typeName,
        typeSymbol: syntheticSymbol,
        fileUri: document.uri,
        isExported: true,
    }
}

/**
 * Get the field or property at the given position.
 * Returns field info if cursor is on a struct field or interface property.
 * Works both at definition site and usage site.
 */
export async function getFieldInfoAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<FieldInfo | null> {
    const languageId = document.languageId

    // Get document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
    )

    if (!symbols) {
        return null
    }

    // First, try to find field/property at definition position
    let fieldInfo: FieldInfo | null = null

    if (languageId === "go") {
        fieldInfo = findGoFieldAtPosition(document, position, symbols)
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        fieldInfo = findTsPropertyAtPosition(document, position, symbols)
    }

    // If found at definition, return it
    if (fieldInfo) {
        return fieldInfo
    }

    // Otherwise, try to find field/property at usage position (e.g., user.email)
    return await findFieldAtUsagePosition(document, position)
}

/**
 * Find field/property at usage position (e.g., user.email).
 * Uses definition provider to locate the field definition.
 */
async function findFieldAtUsagePosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<FieldInfo | null> {
    try {
        // Get the word at cursor (should be the field/property name)
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return null
        }

        // Use definition provider to find the field definition
        const definitions = await vscode.commands.executeCommand<
            (vscode.Location | vscode.LocationLink)[]
        >(
            "vscode.executeDefinitionProvider",
            document.uri,
            position,
        )

        if (!definitions || definitions.length === 0) {
            return null
        }

        // Get the first definition
        const definition = definitions[0]
        let defUri: vscode.Uri
        let defPosition: vscode.Position

        if ("targetUri" in definition) {
            // LocationLink
            defUri = definition.targetUri
            defPosition = definition.targetRange.start
        } else {
            // Location
            defUri = definition.uri
            defPosition = definition.range.start
        }

        // Open the definition document
        const defDocument = await vscode.workspace.openTextDocument(defUri)
        const defLanguageId = defDocument.languageId

        // Get symbols from the definition document
        const defSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            defUri,
        )

        if (!defSymbols) {
            return null
        }

        // Find the field info at the definition position
        if (defLanguageId === "go") {
            return findGoFieldAtPosition(defDocument, defPosition, defSymbols)
        } else if (defLanguageId === "typescript" || defLanguageId === "typescriptreact") {
            return findTsPropertyAtPosition(defDocument, defPosition, defSymbols)
        }
    } catch (error) {
        console.error("Error finding field at usage position:", error)
    }

    return null
}

/**
 * Find Go struct field at position.
 */
function findGoFieldAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): FieldInfo | null {
    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Struct) {
            // Check if position is within this struct
            if (symbol.range.contains(position)) {
                // Look for field in struct children
                for (const child of symbol.children) {
                    if (
                        (child.kind === vscode.SymbolKind.Field ||
                            child.kind === vscode.SymbolKind.Property)
                    ) {
                        // Check if position is within the field's range (more flexible matching)
                        // This handles both definition site and definition provider results
                        if (
                            child.selectionRange.contains(position) ||
                            child.range.contains(position)
                        ) {
                            // Extract JSON tag if present
                            const jsonTag = extractJsonTagFromGoField(document, child)

                            return {
                                name: child.name,
                                jsonTag,
                                parentSymbol: symbol,
                                fieldSymbol: child,
                                fileUri: document.uri,
                            }
                        }
                    }
                }
            }
        }
    }

    return null
}

/**
 * Find TypeScript interface property at position.
 */
function findTsPropertyAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): FieldInfo | null {
    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Interface) {
            // Check if position is within this interface
            if (symbol.range.contains(position)) {
                // Look for property in interface children
                for (const child of symbol.children) {
                    if (
                        (child.kind === vscode.SymbolKind.Property ||
                            child.kind === vscode.SymbolKind.Field)
                    ) {
                        // Check if position is within the property's range (more flexible matching)
                        // This handles both definition site and definition provider results
                        if (
                            child.selectionRange.contains(position) ||
                            child.range.contains(position)
                        ) {
                            return {
                                name: child.name,
                                parentSymbol: symbol,
                                fieldSymbol: child,
                                fileUri: document.uri,
                            }
                        }
                    }
                }
            }
        }
    }

    return null
}

/**
 * Extract JSON tag from Go struct field.
 * Parses the field definition line to extract json:"tagName".
 */
function extractJsonTagFromGoField(
    document: vscode.TextDocument,
    fieldSymbol: vscode.DocumentSymbol,
): string | undefined {
    try {
        const line = document.lineAt(fieldSymbol.range.start.line).text

        // Match json:"tagName" pattern
        // Handle various formats: json:"name", json:"name,omitempty", etc.
        const jsonTagMatch = line.match(/json:"([^,"]+)/)

        if (jsonTagMatch && jsonTagMatch[1]) {
            return jsonTagMatch[1]
        }
    } catch (error) {
        console.error("Error extracting JSON tag:", error)
    }

    return undefined
}

/**
 * Get symbol information (for function/struct/interface) at the given position.
 * Works both at definition site and usage site.
 * Returns null if the symbol is not exported (for structs and interfaces).
 */
export async function getSymbolInfoAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<SymbolInfo | null> {
    const languageId = document.languageId

    // Get the symbol name at cursor
    const symbolName = getSymbolNameAtPosition(document, position)
    if (!symbolName) {
        return null
    }

    // Find the declaration location and symbol kind
    const declarationInfo = await findDeclarationLocationViaReferences(
        document,
        position,
        symbolName,
    )

    if (!declarationInfo) {
        return null
    }

    const { location: declarationLocation, kind: symbolKind } = declarationInfo

    // Check if the symbol is exported (for strict accessibility)
    const isExported = await isSymbolExported(
        declarationLocation.uri,
        declarationLocation.range.start,
        symbolName,
        languageId,
        symbolKind,
    )

    // For structs and interfaces, only process exported ones
    if (
        (symbolKind === vscode.SymbolKind.Struct || symbolKind === vscode.SymbolKind.Interface) &&
        !isExported
    ) {
        return null
    }

    return {
        name: symbolName,
        kind: symbolKind,
        location: declarationLocation,
        isExported,
    }
}

/**
 * Find corresponding field/property in the other language.
 * - For Go -> TS: Find TS interface property by name (using jsonTag if available).
 * - For TS -> Go: Find Go struct field by name (trying jsonTag match first, then name).
 */
export async function findCorrespondingField(
    fieldInfo: FieldInfo,
    sourceLanguage: string,
): Promise<FieldInfo | null> {
    if (sourceLanguage === "go") {
        // Go -> TypeScript
        return await findTsPropertyForGoField(fieldInfo)
    } else if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // TypeScript -> Go
        return await findGoFieldForTsProperty(fieldInfo)
    }

    return null
}

/**
 * Find TypeScript property for a Go struct field.
 * First find the corresponding TS interface, then find the property.
 */
async function findTsPropertyForGoField(goFieldInfo: FieldInfo): Promise<FieldInfo | null> {
    // Find corresponding TS interface
    const tsFiles = await findTsFilesInSameDirectory(goFieldInfo.fileUri)
    if (tsFiles.length === 0) {
        return null
    }

    const structName = goFieldInfo.parentSymbol.name

    // Try to find matching TS interface (lowercase first letter)
    const lowercasedName = lowercaseFirstLetter(structName)
    const searchNames = structName === lowercasedName ? [structName] : [lowercasedName, structName]

    // Search name priority: jsonTag > fieldName
    const propertySearchName = goFieldInfo.jsonTag || goFieldInfo.name

    for (const tsFile of tsFiles) {
        try {
            // Open document to ensure language server is ready
            await vscode.workspace.openTextDocument(tsFile)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                tsFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    searchNames.includes(symbol.name)
                ) {
                    // Found matching interface, now find property
                    for (const child of symbol.children) {
                        if (
                            (child.kind === vscode.SymbolKind.Property ||
                                child.kind === vscode.SymbolKind.Field) &&
                            child.name === propertySearchName
                        ) {
                            return {
                                name: child.name,
                                parentSymbol: symbol,
                                fieldSymbol: child,
                                fileUri: tsFile,
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find Go struct field for a TypeScript interface property.
 * First find the corresponding Go struct, then find the field.
 */
async function findGoFieldForTsProperty(tsPropertyInfo: FieldInfo): Promise<FieldInfo | null> {
    // Find corresponding Go struct
    const goFiles = await findGoFilesInSameDirectory(tsPropertyInfo.fileUri)
    if (goFiles.length === 0) {
        return null
    }

    const interfaceName = tsPropertyInfo.parentSymbol.name

    // Try to find matching Go struct (capitalize first letter)
    const capitalizedName = capitalizeFirstLetter(interfaceName)
    const searchNames = interfaceName === capitalizedName
        ? [interfaceName]
        : [capitalizedName, interfaceName]

    const propertyName = tsPropertyInfo.name

    for (const goFile of goFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(goFile)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                goFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Struct &&
                    searchNames.includes(symbol.name)
                ) {
                    // Found matching struct, now find field
                    // Try 1: Match by JSON tag
                    for (const child of symbol.children) {
                        if (
                            (child.kind === vscode.SymbolKind.Field ||
                                child.kind === vscode.SymbolKind.Property)
                        ) {
                            const jsonTag = extractJsonTagFromGoField(document, child)
                            if (jsonTag === propertyName) {
                                return {
                                    name: child.name,
                                    jsonTag,
                                    parentSymbol: symbol,
                                    fieldSymbol: child,
                                    fileUri: goFile,
                                }
                            }
                        }
                    }

                    // Try 2: Match by field name
                    for (const child of symbol.children) {
                        if (
                            (child.kind === vscode.SymbolKind.Field ||
                                child.kind === vscode.SymbolKind.Property) &&
                            child.name === propertyName
                        ) {
                            const jsonTag = extractJsonTagFromGoField(document, child)
                            return {
                                name: child.name,
                                jsonTag,
                                parentSymbol: symbol,
                                fieldSymbol: child,
                                fileUri: goFile,
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Get the interface method at the given position.
 * Returns method info if cursor is on an interface method.
 * Works both at definition site and usage site.
 */
export async function getInterfaceMethodInfoAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<InterfaceMethodInfo | null> {
    const languageId = document.languageId

    // Get document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
    )

    if (!symbols) {
        return null
    }

    // First, try to find method at definition position
    let methodInfo: InterfaceMethodInfo | null = null

    if (languageId === "go") {
        methodInfo = findGoInterfaceMethodAtPosition(document, position, symbols)
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        methodInfo = findTsInterfaceMethodAtPosition(document, position, symbols)
    }

    // If found at definition, return it
    if (methodInfo) {
        return methodInfo
    }

    // Otherwise, try to find method at usage position
    return await findInterfaceMethodAtUsagePosition(document, position)
}

/**
 * Find Go interface method at position.
 */
function findGoInterfaceMethodAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): InterfaceMethodInfo | null {
    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Interface) {
            // Check if position is within this interface
            if (symbol.range.contains(position)) {
                // Look for method in interface children
                for (const child of symbol.children) {
                    if (child.kind === vscode.SymbolKind.Method) {
                        // Check if position is within the method's range
                        if (
                            child.selectionRange.contains(position) ||
                            child.range.contains(position)
                        ) {
                            // In Go, interface methods are always exported if the interface is exported
                            const isExported = symbol.name[0] === symbol.name[0].toUpperCase()

                            return {
                                name: child.name,
                                parentSymbol: symbol,
                                methodSymbol: child,
                                fileUri: document.uri,
                                isExported,
                            }
                        }
                    }
                }
            }
        }
    }

    return null
}

/**
 * Find TypeScript interface method at position.
 */
function findTsInterfaceMethodAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): InterfaceMethodInfo | null {
    for (const symbol of symbols) {
        if (symbol.kind === vscode.SymbolKind.Interface) {
            // Check if position is within this interface
            if (symbol.range.contains(position)) {
                // Look for method in interface children
                for (const child of symbol.children) {
                    if (child.kind === vscode.SymbolKind.Method) {
                        // Check if position is within the method's range
                        if (
                            child.selectionRange.contains(position) ||
                            child.range.contains(position)
                        ) {
                            // Check if TypeScript interface is exported
                            const line = document.lineAt(symbol.range.start.line).text
                            const isExported = /^\s*export\s+/.test(line)

                            return {
                                name: child.name,
                                parentSymbol: symbol,
                                methodSymbol: child,
                                fileUri: document.uri,
                                isExported,
                            }
                        }
                    }
                }
            }
        }
    }

    return null
}

/**
 * Find interface method at usage position.
 * Uses definition provider to locate the method definition.
 */
async function findInterfaceMethodAtUsagePosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<InterfaceMethodInfo | null> {
    try {
        // Get the word at cursor (should be the method name)
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return null
        }

        // Use definition provider to find the method definition
        const definitions = await vscode.commands.executeCommand<
            (vscode.Location | vscode.LocationLink)[]
        >(
            "vscode.executeDefinitionProvider",
            document.uri,
            position,
        )

        if (!definitions || definitions.length === 0) {
            return null
        }

        // Get the first definition
        const definition = definitions[0]
        let defUri: vscode.Uri
        let defPosition: vscode.Position

        if ("targetUri" in definition) {
            // LocationLink
            defUri = definition.targetUri
            defPosition = definition.targetRange.start
        } else {
            // Location
            defUri = definition.uri
            defPosition = definition.range.start
        }

        // Open the definition document
        const defDocument = await vscode.workspace.openTextDocument(defUri)
        const defLanguageId = defDocument.languageId

        // Get symbols from the definition document
        const defSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            defUri,
        )

        if (!defSymbols) {
            return null
        }

        // Find the method info at the definition position
        if (defLanguageId === "go") {
            return findGoInterfaceMethodAtPosition(defDocument, defPosition, defSymbols)
        } else if (defLanguageId === "typescript" || defLanguageId === "typescriptreact") {
            return findTsInterfaceMethodAtPosition(defDocument, defPosition, defSymbols)
        }
    } catch (error) {
        console.error("Error finding interface method at usage position:", error)
    }

    return null
}

/**
 * Find corresponding interface method in the other language.
 * - For Go -> TS: Find TS interface method by name.
 * - For TS -> Go: Find Go interface method by name.
 */
export async function findCorrespondingInterfaceMethod(
    methodInfo: InterfaceMethodInfo,
    sourceLanguage: string,
): Promise<InterfaceMethodInfo | null> {
    if (sourceLanguage === "go") {
        // Go -> TypeScript
        return await findTsMethodForGoMethod(methodInfo)
    } else if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // TypeScript -> Go
        return await findGoMethodForTsMethod(methodInfo)
    }

    return null
}

/**
 * Find TypeScript interface method for a Go interface method.
 * First find the corresponding TS interface, then find the method.
 */
async function findTsMethodForGoMethod(
    goMethodInfo: InterfaceMethodInfo,
): Promise<InterfaceMethodInfo | null> {
    // Find corresponding TS interface
    const tsFiles = await findTsFilesInSameDirectory(goMethodInfo.fileUri)
    if (tsFiles.length === 0) {
        return null
    }

    const interfaceName = goMethodInfo.parentSymbol.name

    // Interface name must match exactly (no case conversion)
    const searchNames = [interfaceName]

    // Method name: lowercase first letter
    const methodSearchName = lowercaseFirstLetter(goMethodInfo.name)

    for (const tsFile of tsFiles) {
        try {
            // Open document to ensure language server is ready
            const document = await vscode.workspace.openTextDocument(tsFile)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                tsFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    searchNames.includes(symbol.name)
                ) {
                    // Found matching interface, now find method
                    for (const child of symbol.children) {
                        if (
                            child.kind === vscode.SymbolKind.Method &&
                            child.name === methodSearchName
                        ) {
                            // Check if TypeScript interface is exported
                            const line = document.lineAt(symbol.range.start.line).text
                            const isExported = /^\s*export\s+/.test(line)

                            return {
                                name: child.name,
                                parentSymbol: symbol,
                                methodSymbol: child,
                                fileUri: tsFile,
                                isExported,
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find Go interface method for a TypeScript interface method.
 * First find the corresponding Go interface, then find the method.
 */
async function findGoMethodForTsMethod(
    tsMethodInfo: InterfaceMethodInfo,
): Promise<InterfaceMethodInfo | null> {
    // Find corresponding Go interface
    const goFiles = await findGoFilesInSameDirectory(tsMethodInfo.fileUri)
    if (goFiles.length === 0) {
        return null
    }

    const interfaceName = tsMethodInfo.parentSymbol.name

    // Interface name must match exactly (no case conversion)
    const searchNames = [interfaceName]

    // Method name: capitalize first letter
    const methodSearchName = capitalizeFirstLetter(tsMethodInfo.name)

    for (const goFile of goFiles) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                goFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    searchNames.includes(symbol.name)
                ) {
                    // Found matching interface, now find method
                    for (const child of symbol.children) {
                        if (
                            child.kind === vscode.SymbolKind.Method &&
                            child.name === methodSearchName
                        ) {
                            // In Go, interface methods are always exported if the interface is exported
                            const isExported = symbol.name[0] === symbol.name[0].toUpperCase()

                            return {
                                name: child.name,
                                parentSymbol: symbol,
                                methodSymbol: child,
                                fileUri: goFile,
                                isExported,
                            }
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Get the interface at the given position (the interface itself, not its members).
 * Returns interface info if cursor is on an interface name.
 * Works both at definition site and usage site.
 */
export async function getInterfaceInfoAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<InterfaceInfo | null> {
    const languageId = document.languageId

    // Get document symbols
    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        "vscode.executeDocumentSymbolProvider",
        document.uri,
    )

    if (!symbols) {
        return null
    }

    // First, try to find interface at definition position
    let interfaceInfo: InterfaceInfo | null = null

    if (languageId === "go") {
        interfaceInfo = findGoInterfaceAtPosition(document, position, symbols)
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        interfaceInfo = findTsInterfaceAtPosition(document, position, symbols)
    }

    // If found at definition, return it
    if (interfaceInfo) {
        return interfaceInfo
    }

    // Otherwise, try to find interface at usage position
    return await findInterfaceAtUsagePosition(document, position)
}

/**
 * Find Go interface or struct at position.
 */
function findGoInterfaceAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): InterfaceInfo | null {
    for (const symbol of symbols) {
        // Match both interface and struct
        if (
            symbol.kind === vscode.SymbolKind.Interface ||
            symbol.kind === vscode.SymbolKind.Struct
        ) {
            // Check if position is within the interface/struct name (selectionRange)
            if (symbol.selectionRange.contains(position)) {
                // Check if the interface/struct is exported
                const isExported = symbol.name[0] === symbol.name[0].toUpperCase()

                // Check if the interface has methods (struct won't have methods in symbol tree)
                const hasMethods = symbol.children.some((child) =>
                    child.kind === vscode.SymbolKind.Method
                )

                return {
                    name: symbol.name,
                    symbol,
                    fileUri: document.uri,
                    isExported,
                    hasMethods,
                }
            }
        }
    }

    return null
}

/**
 * Find TypeScript interface or type alias at position.
 */
function findTsInterfaceAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
    symbols: vscode.DocumentSymbol[],
): InterfaceInfo | null {
    for (const symbol of symbols) {
        // Match both interface and type alias (Variable)
        if (
            symbol.kind === vscode.SymbolKind.Interface ||
            symbol.kind === vscode.SymbolKind.Variable
        ) {
            // Check if position is within the interface/type name (selectionRange)
            if (symbol.selectionRange.contains(position)) {
                // Check if TypeScript symbol is exported
                const line = document.lineAt(symbol.range.start.line).text
                const isExported = /^\s*export\s+/.test(line)

                // For type alias, verify it's actually a type definition
                if (symbol.kind === vscode.SymbolKind.Variable) {
                    // Check if it's "export type Name = ..."
                    if (!/^\s*export\s+type\s+/.test(line)) {
                        continue
                    }
                }

                // Check if the interface has methods
                const hasMethods = symbol.children.some((child) =>
                    child.kind === vscode.SymbolKind.Method
                )

                return {
                    name: symbol.name,
                    symbol,
                    fileUri: document.uri,
                    isExported,
                    hasMethods,
                }
            }
        }
    }

    return null
}

/**
 * Find interface at usage position.
 * Uses definition provider to locate the interface definition.
 */
async function findInterfaceAtUsagePosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): Promise<InterfaceInfo | null> {
    try {
        // Get the word at cursor (should be the interface name)
        const wordRange = document.getWordRangeAtPosition(position)
        if (!wordRange) {
            return null
        }

        // Use definition provider to find the interface definition
        const definitions = await vscode.commands.executeCommand<
            (vscode.Location | vscode.LocationLink)[]
        >(
            "vscode.executeDefinitionProvider",
            document.uri,
            position,
        )

        if (!definitions || definitions.length === 0) {
            return null
        }

        // Get the first definition
        const definition = definitions[0]
        let defUri: vscode.Uri
        let defPosition: vscode.Position

        if ("targetUri" in definition) {
            // LocationLink
            defUri = definition.targetUri
            defPosition = definition.targetRange.start
        } else {
            // Location
            defUri = definition.uri
            defPosition = definition.range.start
        }

        // Open the definition document
        const defDocument = await vscode.workspace.openTextDocument(defUri)
        const defLanguageId = defDocument.languageId

        // Get symbols from the definition document
        const defSymbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            defUri,
        )

        if (!defSymbols) {
            return null
        }

        // Find the interface info at the definition position
        if (defLanguageId === "go") {
            return findGoInterfaceAtPosition(defDocument, defPosition, defSymbols)
        } else if (defLanguageId === "typescript" || defLanguageId === "typescriptreact") {
            return findTsInterfaceAtPosition(defDocument, defPosition, defSymbols)
        }
    } catch (error) {
        console.error("Error finding interface at usage position:", error)
    }

    return null
}

/**
 * Find corresponding interface in the other language.
 * - For Go interface (with methods) -> TS interface (with methods)
 * - For Go interface (without methods, type constraint) -> TS type alias
 * - For Go struct -> TS interface (without methods, only properties)
 * - For TS interface (with methods) -> Go interface (with methods)
 * - For TS interface (without methods, only properties) -> Go struct
 * - For TS type alias -> Go interface (without methods, type constraint)
 */
export async function findCorrespondingInterface(
    interfaceInfo: InterfaceInfo,
    sourceLanguage: string,
): Promise<InterfaceInfo | null> {
    if (sourceLanguage === "go") {
        // Go -> TypeScript
        if (interfaceInfo.symbol.kind === vscode.SymbolKind.Interface) {
            if (interfaceInfo.hasMethods) {
                // Go interface with methods -> TS interface with methods
                return await findTsInterfaceForGoInterface(interfaceInfo)
            } else {
                // Go interface without methods (type constraint) -> TS type alias
                return await findTsTypeAliasForGoInterface(interfaceInfo)
            }
        } else if (interfaceInfo.symbol.kind === vscode.SymbolKind.Struct) {
            // Go struct -> TS interface without methods (only properties)
            return await findTsInterfaceForGoStruct(interfaceInfo)
        }
        return null
    } else if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // TypeScript -> Go
        if (interfaceInfo.symbol.kind === vscode.SymbolKind.Interface) {
            if (interfaceInfo.hasMethods) {
                // TS interface with methods -> Go interface with methods
                return await findGoInterfaceForTsInterface(interfaceInfo)
            } else {
                // TS interface without methods -> Go struct
                // Return struct as InterfaceInfo for consistency
                return await findGoStructForTsInterface(interfaceInfo)
            }
        } else if (interfaceInfo.symbol.kind === vscode.SymbolKind.Variable) {
            // TS type alias -> Go interface without methods (type constraint)
            return await findGoInterfaceForTsTypeAlias(interfaceInfo)
        }
    }

    return null
}

/**
 * Find TypeScript interface for a Go interface.
 */
async function findTsInterfaceForGoInterface(
    goInterfaceInfo: InterfaceInfo,
): Promise<InterfaceInfo | null> {
    const tsFiles = await findTsFilesInSameDirectory(goInterfaceInfo.fileUri)
    if (tsFiles.length === 0) {
        return null
    }

    const interfaceName = goInterfaceInfo.name

    for (const tsFile of tsFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(tsFile)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                tsFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    symbol.name === interfaceName
                ) {
                    // Check if TypeScript interface is exported
                    const line = document.lineAt(symbol.range.start.line).text
                    const isExported = /^\s*export\s+/.test(line)

                    // Only match if it's exported
                    if (!isExported) {
                        continue
                    }

                    // Check if the interface has methods
                    const hasMethods = symbol.children.some((child) =>
                        child.kind === vscode.SymbolKind.Method
                    )

                    // Only return if it has methods (matching Go interface)
                    if (hasMethods) {
                        return {
                            name: symbol.name,
                            symbol,
                            fileUri: tsFile,
                            isExported,
                            hasMethods,
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find Go interface for a TypeScript interface (with methods).
 */
async function findGoInterfaceForTsInterface(
    tsInterfaceInfo: InterfaceInfo,
): Promise<InterfaceInfo | null> {
    const goFiles = await findGoFilesInSameDirectory(tsInterfaceInfo.fileUri)
    if (goFiles.length === 0) {
        return null
    }

    const interfaceName = tsInterfaceInfo.name

    for (const goFile of goFiles) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                goFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    symbol.name === interfaceName
                ) {
                    // Check if the interface is exported
                    const isExported = symbol.name[0] === symbol.name[0].toUpperCase()

                    // Only match if it's exported
                    if (!isExported) {
                        continue
                    }

                    // Check if the interface has methods
                    const hasMethods = symbol.children.some((child) =>
                        child.kind === vscode.SymbolKind.Method
                    )

                    return {
                        name: symbol.name,
                        symbol,
                        fileUri: goFile,
                        isExported,
                        hasMethods,
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find Go struct for a TypeScript interface (without methods, only properties).
 */
async function findGoStructForTsInterface(
    tsInterfaceInfo: InterfaceInfo,
): Promise<InterfaceInfo | null> {
    const goFiles = await findGoFilesInSameDirectory(tsInterfaceInfo.fileUri)
    if (goFiles.length === 0) {
        return null
    }

    const interfaceName = tsInterfaceInfo.name

    for (const goFile of goFiles) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                goFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Struct &&
                    symbol.name === interfaceName
                ) {
                    // Check if the struct is exported
                    const isExported = symbol.name[0] === symbol.name[0].toUpperCase()

                    // Only match if it's exported
                    if (!isExported) {
                        continue
                    }

                    // Return struct as InterfaceInfo for consistency
                    return {
                        name: symbol.name,
                        symbol,
                        fileUri: goFile,
                        isExported,
                        hasMethods: false, // Struct doesn't have methods in the symbol tree
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find TypeScript type alias for a Go interface (without methods, type constraint).
 */
async function findTsTypeAliasForGoInterface(
    goInterfaceInfo: InterfaceInfo,
): Promise<InterfaceInfo | null> {
    const tsFiles = await findTsFilesInSameDirectory(goInterfaceInfo.fileUri)
    if (tsFiles.length === 0) {
        return null
    }

    const interfaceName = goInterfaceInfo.name

    for (const tsFile of tsFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(tsFile)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                tsFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                // Type alias shows as Variable in VS Code
                if (
                    symbol.kind === vscode.SymbolKind.Variable &&
                    symbol.name === interfaceName
                ) {
                    // Check if it's a type alias (export type Name = ...)
                    const line = document.lineAt(symbol.range.start.line).text
                    if (!/^\s*export\s+type\s+/.test(line)) {
                        continue
                    }

                    return {
                        name: symbol.name,
                        symbol,
                        fileUri: tsFile,
                        isExported: true, // Already verified by regex
                        hasMethods: false, // Type alias doesn't have methods
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find Go interface (without methods, type constraint) for a TypeScript type alias.
 */
async function findGoInterfaceForTsTypeAlias(
    tsTypeAliasInfo: InterfaceInfo,
): Promise<InterfaceInfo | null> {
    const goFiles = await findGoFilesInSameDirectory(tsTypeAliasInfo.fileUri)
    if (goFiles.length === 0) {
        return null
    }

    const typeName = tsTypeAliasInfo.name

    for (const goFile of goFiles) {
        try {
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                goFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    symbol.name === typeName
                ) {
                    // Check if the interface is exported
                    const isExported = symbol.name[0] === symbol.name[0].toUpperCase()

                    // Only match if it's exported
                    if (!isExported) {
                        continue
                    }

                    // Check if the interface has no methods (type constraint)
                    const hasMethods = symbol.children.some((child) =>
                        child.kind === vscode.SymbolKind.Method
                    )

                    // Only return if it has no methods (type constraint)
                    if (!hasMethods) {
                        return {
                            name: symbol.name,
                            symbol,
                            fileUri: goFile,
                            isExported,
                            hasMethods: false,
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return null
}

/**
 * Find TypeScript interface (without methods, only properties) for a Go struct.
 */
async function findTsInterfaceForGoStruct(
    goStructInfo: InterfaceInfo,
): Promise<InterfaceInfo | null> {
    const tsFiles = await findTsFilesInSameDirectory(goStructInfo.fileUri)
    if (tsFiles.length === 0) {
        return null
    }

    const structName = goStructInfo.name

    for (const tsFile of tsFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(tsFile)
            const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                "vscode.executeDocumentSymbolProvider",
                tsFile,
            )

            if (!symbols) {
                continue
            }

            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Interface &&
                    symbol.name === structName
                ) {
                    // Check if TypeScript interface is exported
                    const line = document.lineAt(symbol.range.start.line).text
                    const isExported = /^\s*export\s+/.test(line)

                    // Only match if it's exported
                    if (!isExported) {
                        continue
                    }

                    // Check if the interface has no methods (only properties)
                    const hasMethods = symbol.children.some((child) =>
                        child.kind === vscode.SymbolKind.Method
                    )

                    // Only return if it has no methods (only properties)
                    if (!hasMethods) {
                        return {
                            name: symbol.name,
                            symbol,
                            fileUri: tsFile,
                            isExported,
                            hasMethods: false,
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return null
}
