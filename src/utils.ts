import * as vscode from "vscode"
import * as path from "node:path"

/**
 * Get the function name at the given position
 * This can be either:
 * 1. A function being called (e.g., cursor on "getArticle" in "getArticle()")
 * 2. A function declaration (e.g., cursor on function name in "function getArticle()")
 */
export function getFunctionNameAtPosition(
    document: vscode.TextDocument,
    position: vscode.Position,
): string | null {
    // First, try to get the identifier at the exact cursor position
    const wordRange = document.getWordRangeAtPosition(position)
    if (wordRange) {
        const word = document.getText(wordRange)
        // Verify this is actually a function name (not a keyword, etc.)
        if (word && /^[a-zA-Z_]\w*$/.test(word)) {
            return word
        }
    }

    // Fallback: try to extract function name from text pattern matching
    return extractFunctionNameFromText(document, position)
}

/**
 * Extract function name from text at position (fallback method)
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
 * Capitalize the first letter of a string
 */
export function capitalizeFirstLetter(str: string): string {
    if (!str) { return str }
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Lowercase the first letter of a string
 */
export function lowercaseFirstLetter(str: string): string {
    if (!str) { return str }
    return str.charAt(0).toLowerCase() + str.slice(1)
}

/**
 * Find all Go files in the same directory as the given file
 */
export async function findGoFilesInSameDirectory(fileUri: vscode.Uri): Promise<vscode.Uri[]> {
    const dirPath = path.dirname(fileUri.fsPath)

    const pattern = new vscode.RelativePattern(dirPath, "*.go")
    const files = await vscode.workspace.findFiles(pattern)

    return files
}

/**
 * Find all TypeScript files in the same directory as the given file
 */
export async function findTsFilesInSameDirectory(fileUri: vscode.Uri): Promise<vscode.Uri[]> {
    const dirPath = path.dirname(fileUri.fsPath)

    const pattern = new vscode.RelativePattern(dirPath, "*.{ts,tsx}")
    const files = await vscode.workspace.findFiles(pattern)

    return files
}

/**
 * Check if a symbol is exported
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
        const firstChar = symbolName[0]
        return firstChar === firstChar.toUpperCase()
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
 * Recursively find a symbol (function/struct/interface) whose selectionRange contains the position
 * This finds the declaration, not usages
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
 * (for functions, structs, or interfaces)
 * Uses vscode.executeReferenceProvider which is safe due to global recursion guard
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
 * (for interfaces primarily)
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
 * Symbol match candidate with score
 */
export interface SymbolCandidate {
    symbol: vscode.DocumentSymbol
    fileUri: vscode.Uri
    score: number // Higher is better: 3 = accessibility + exact name (best), 2 = accessibility match, 1 = exact name match, 0 = any match
}

/**
 * Calculate match score for a symbol candidate
 * Higher score is better: 3 = accessibility + exact name (best), 2 = accessibility match, 1 = exact name match, 0 = any match
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
 * Find matching symbols in Go files (functions, structs)
 * Returns candidates with score for further processing
 */
export async function findMatchingSymbolsInGoFiles(
    goFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
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
                // Match the same kind of symbol
                let isMatch = false
                if (symbolKind === vscode.SymbolKind.Function) {
                    isMatch = symbol.kind === vscode.SymbolKind.Function &&
                        symbolNames.includes(symbol.name) &&
                        isTopLevelFunction(symbol, symbols)
                } else if (symbolKind === vscode.SymbolKind.Interface) {
                    // TS interface -> Go struct
                    isMatch = symbol.kind === vscode.SymbolKind.Struct &&
                        symbolNames.includes(symbol.name)
                }

                if (isMatch) {
                    const firstChar = symbol.name[0]
                    const isGoExported = firstChar === firstChar.toUpperCase()

                    // For structs/interfaces, only match exported ones
                    if (symbolKind === vscode.SymbolKind.Interface && !isGoExported) {
                        continue
                    }

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
 * Find matching symbols in TypeScript files (functions, interfaces)
 * Returns candidates with score for further processing
 */
export async function findMatchingSymbolsInTsFiles(
    tsFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
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
                // Match the same kind of symbol
                let isMatch = false
                if (symbolKind === vscode.SymbolKind.Function) {
                    isMatch = symbol.kind === vscode.SymbolKind.Function &&
                        symbolNames.includes(symbol.name) &&
                        isTopLevelFunction(symbol, symbols)
                } else if (symbolKind === vscode.SymbolKind.Struct) {
                    // Go struct -> TS interface
                    isMatch = symbol.kind === vscode.SymbolKind.Interface &&
                        symbolNames.includes(symbol.name)
                }

                if (isMatch) {
                    // Check if TypeScript symbol is exported
                    const line = document.lineAt(symbol.range.start.line).text
                    const isTsExported = /^\s*export\s+/.test(line)

                    // For structs/interfaces, only match exported ones
                    if (symbolKind === vscode.SymbolKind.Struct && !isTsExported) {
                        continue
                    }

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
 * Check if a symbol is a top-level function
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
 * Check if a symbol is nested inside another symbol
 */
export function isSymbolNested(
    symbol: vscode.DocumentSymbol,
    parent: vscode.DocumentSymbol,
): boolean {
    return parent.range.contains(symbol.range) && !parent.range.isEqual(symbol.range)
}
