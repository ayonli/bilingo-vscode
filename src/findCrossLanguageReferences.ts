import * as vscode from "vscode"
import { isStrictAccessibilityEnabled } from "./config"
import { capitalizeFirstLetter, getFunctionNameAtPosition, lowercaseFirstLetter } from "./utils"

/**
 * Find cross-language references for TypeScript and Go
 * Only returns references from the OTHER language, not the current language
 */
export async function findCrossLanguageReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    _token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
    const languageId = document.languageId

    // Get the symbol name at cursor
    const symbolName = getFunctionNameAtPosition(document, position)
    if (!symbolName) {
        return []
    }

    // Find the declaration location and symbol kind
    const declarationInfo = await findDeclarationLocation(document, position, symbolName)

    if (!declarationInfo) {
        return []
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
        return []
    }

    // Find ONLY cross-language references (not current language)
    let crossLanguageReferences: vscode.Location[] = []

    if (languageId === "typescript" || languageId === "typescriptreact") {
        // From TypeScript, find Go references ONLY
        crossLanguageReferences = await findGoReferences(
            declarationLocation.uri,
            symbolName,
            isExported,
            symbolKind,
        )
    } else if (languageId === "go") {
        // From Go, find TypeScript references ONLY
        crossLanguageReferences = await findTsReferences(
            declarationLocation.uri,
            symbolName,
            isExported,
            symbolKind,
        )
    }

    // Return ONLY cross-language references
    // Current language references will be provided by the native language server
    return crossLanguageReferences
}

interface DeclarationInfo {
    location: vscode.Location
    kind: vscode.SymbolKind
}

/**
 * Find the symbol declaration location (function, struct, or interface)
 * Uses vscode.executeReferenceProvider which is safe due to global recursion guard
 */
async function findDeclarationLocation(
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

            // Look for a top-level symbol (function, struct, or interface)
            for (const symbol of symbols) {
                if (
                    (symbol.kind === vscode.SymbolKind.Function ||
                        symbol.kind === vscode.SymbolKind.Struct ||
                        symbol.kind === vscode.SymbolKind.Interface) &&
                    symbol.name === symbolName &&
                    symbol.range.contains(ref.range.start)
                ) {
                    return {
                        location: new vscode.Location(ref.uri, symbol.selectionRange.start),
                        kind: symbol.kind,
                    }
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
 * Check if a symbol is exported
 */
async function isSymbolExported(
    fileUri: vscode.Uri,
    position: vscode.Position,
    symbolName: string,
    languageId: string,
    symbolKind: vscode.SymbolKind,
): Promise<boolean> {
    if (languageId === "go") {
        // In Go, exported symbols start with uppercase letter
        return symbolName[0] === symbolName[0].toUpperCase()
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
            if (
                symbol.kind === symbolKind &&
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

/**
 * Find Go references for a TypeScript symbol
 */
async function findGoReferences(
    tsFileUri: vscode.Uri,
    symbolName: string,
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    // Find Go files in the same directory
    const goFiles = await findGoFilesInSameDirectory(tsFileUri)
    if (goFiles.length === 0) {
        return []
    }

    // Try both original name and capitalized
    const capitalizedName = capitalizeFirstLetter(symbolName)
    const searchNames = symbolName === capitalizedName
        ? [symbolName]
        : [capitalizedName, symbolName]

    return await findSymbolInGoFiles(goFiles, searchNames, isSourceExported, symbolKind)
}

/**
 * Find TypeScript references for a Go symbol
 */
async function findTsReferences(
    goFileUri: vscode.Uri,
    symbolName: string,
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    // Find TypeScript files in the same directory
    const tsFiles = await findTsFilesInSameDirectory(goFileUri)
    if (tsFiles.length === 0) {
        return []
    }

    // Try both original name and lowercase first letter
    const lowercasedName = lowercaseFirstLetter(symbolName)
    const searchNames = symbolName === lowercasedName ? [symbolName] : [lowercasedName, symbolName]

    return await findSymbolInTsFiles(tsFiles, searchNames, isSourceExported, symbolKind)
}

/**
 * Find all Go files in the same directory as the given file
 */
async function findGoFilesInSameDirectory(fileUri: vscode.Uri): Promise<vscode.Uri[]> {
    const path = require("path")
    const dirPath = path.dirname(fileUri.fsPath)

    const pattern = new vscode.RelativePattern(dirPath, "*.go")
    const files = await vscode.workspace.findFiles(pattern)

    return files
}

/**
 * Find all TypeScript files in the same directory as the given file
 */
async function findTsFilesInSameDirectory(fileUri: vscode.Uri): Promise<vscode.Uri[]> {
    const path = require("path")
    const dirPath = path.dirname(fileUri.fsPath)

    const pattern = new vscode.RelativePattern(dirPath, "*.{ts,tsx}")
    const files = await vscode.workspace.findFiles(pattern)

    return files
}

/**
 * Check if a symbol is a top-level function
 */
function isTopLevelFunction(
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
function isSymbolNested(
    symbol: vscode.DocumentSymbol,
    parent: vscode.DocumentSymbol,
): boolean {
    return parent.range.contains(symbol.range) && !parent.range.isEqual(symbol.range)
}

/**
 * Find symbol references in Go files (functions, structs)
 */
async function findSymbolInGoFiles(
    goFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    const strictAccessibility = isStrictAccessibilityEnabled()

    // Collect all candidate matches with their priority
    interface Candidate {
        symbol: vscode.DocumentSymbol
        fileUri: vscode.Uri
        priority: number // 0 = accessibility match (best), 1 = exact name match, 2 = any match
    }
    const candidates: Candidate[] = []

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
                } else if (symbolKind === vscode.SymbolKind.Struct) {
                    // Should not happen (Go to TS, struct already handled)
                    isMatch = false
                }

                if (isMatch) {
                    const isGoExported = symbol.name[0] === symbol.name[0].toUpperCase()

                    // For structs/interfaces, only match exported ones
                    if (symbolKind === vscode.SymbolKind.Interface && !isGoExported) {
                        continue
                    }

                    // Check accessibility if strict mode is enabled
                    if (strictAccessibility && isSourceExported !== isGoExported) {
                        continue
                    }

                    // Calculate priority
                    const exactName = symbol.name === symbolNames[0]
                    const sameAccessibility = isSourceExported === isGoExported

                    let priority = 2
                    if (sameAccessibility) {
                        priority = 0
                    } else if (exactName) {
                        priority = 1
                    }

                    candidates.push({ symbol, fileUri, priority })
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${fileUri.fsPath}:`, error)
        }
    }
    // If no candidates, return empty
    if (candidates.length === 0) {
        return []
    }

    // Sort by priority and get the best priority
    candidates.sort((a, b) => a.priority - b.priority)
    const bestPriority = candidates[0].priority

    // Get all references from candidates with the best priority
    const allLocations: vscode.Location[] = []
    for (const candidate of candidates) {
        if (candidate.priority !== bestPriority) {
            break // Since sorted, we can stop here
        }

        try {
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                "vscode.executeReferenceProvider",
                candidate.fileUri,
                candidate.symbol.selectionRange.start,
            )

            if (references) {
                allLocations.push(...references)
            }
        } catch (error) {
            console.error(`Error getting references:`, error)
        }
    }

    // Remove duplicates
    const uniqueLocations = allLocations.filter((loc, index, self) =>
        index === self.findIndex((l) =>
            l.uri.fsPath === loc.uri.fsPath &&
            l.range.start.line === loc.range.start.line &&
            l.range.start.character === loc.range.start.character
        )
    )

    return uniqueLocations
}

/**
 * Find symbol references in TypeScript files (functions, interfaces)
 */
async function findSymbolInTsFiles(
    tsFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    const strictAccessibility = isStrictAccessibilityEnabled()

    // Open all TypeScript files to ensure language server is ready
    await Promise.all(
        tsFiles.map((fileUri) => vscode.workspace.openTextDocument(fileUri)),
    )

    await new Promise((resolve) => setTimeout(resolve, 100))

    // Collect all candidate matches with their priority
    interface Candidate {
        symbol: vscode.DocumentSymbol
        fileUri: vscode.Uri
        priority: number // 0 = accessibility match (best), 1 = exact name match, 2 = any match
    }
    const candidates: Candidate[] = []

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
                } else if (symbolKind === vscode.SymbolKind.Interface) {
                    // Should not happen (TS to Go, interface already handled)
                    isMatch = false
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

                    // Calculate priority
                    const exactName = symbol.name === symbolNames[0]
                    const sameAccessibility = isSourceExported === isTsExported

                    let priority = 2
                    if (sameAccessibility) {
                        priority = 0
                    } else if (exactName) {
                        priority = 1
                    }

                    candidates.push({ symbol, fileUri, priority })
                }
            }
        } catch (error) {
            console.error(`Error processing TypeScript file ${fileUri.fsPath}:`, error)
        }
    }

    // If no candidates, return empty
    if (candidates.length === 0) {
        return []
    }

    // Sort by priority and get the best priority
    candidates.sort((a, b) => a.priority - b.priority)
    const bestPriority = candidates[0].priority

    // Get all references from candidates with the best priority
    const allLocations: vscode.Location[] = []
    for (const candidate of candidates) {
        if (candidate.priority !== bestPriority) {
            break // Since sorted, we can stop here
        }

        try {
            const references = await vscode.commands.executeCommand<vscode.Location[]>(
                "vscode.executeReferenceProvider",
                candidate.fileUri,
                candidate.symbol.selectionRange.start,
            )

            if (references) {
                allLocations.push(...references)
            }
        } catch (error) {
            console.error(`Error getting references:`, error)
        }
    }

    // Remove duplicates
    const uniqueLocations = allLocations.filter((loc, index, self) =>
        index === self.findIndex((l) =>
            l.uri.fsPath === loc.uri.fsPath &&
            l.range.start.line === loc.range.start.line &&
            l.range.start.character === loc.range.start.character
        )
    )

    return uniqueLocations
}
