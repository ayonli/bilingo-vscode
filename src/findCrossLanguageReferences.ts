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

    // Get the function name at cursor
    const functionName = getFunctionNameAtPosition(document, position)
    if (!functionName) {
        return []
    }

    // Find the declaration location
    // This is safe because the global flag prevents our provider from being called again
    const declarationLocation = await findDeclarationLocation(document, position, functionName)

    if (!declarationLocation) {
        return []
    }

    // Check if the function is exported (for strict accessibility)
    const isExported = await isFunctionExported(
        declarationLocation.uri,
        declarationLocation.range.start,
        functionName,
        languageId,
    )

    // Find ONLY cross-language references (not current language)
    let crossLanguageReferences: vscode.Location[] = []

    if (languageId === "typescript" || languageId === "typescriptreact") {
        // From TypeScript, find Go references ONLY
        crossLanguageReferences = await findGoReferencesForFunction(
            declarationLocation.uri,
            functionName,
            isExported,
        )
    } else if (languageId === "go") {
        // From Go, find TypeScript references ONLY
        crossLanguageReferences = await findTsReferencesForFunction(
            declarationLocation.uri,
            functionName,
            isExported,
        )
    }

    // Return ONLY cross-language references
    // Current language references will be provided by the native language server
    return crossLanguageReferences
}

/**
 * Find the function declaration location
 * Uses vscode.executeReferenceProvider which is safe due to global recursion guard
 */
async function findDeclarationLocation(
    document: vscode.TextDocument,
    position: vscode.Position,
    functionName: string,
): Promise<vscode.Location | null> {
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

            // Look for a top-level function symbol that contains this reference
            for (const symbol of symbols) {
                if (
                    symbol.kind === vscode.SymbolKind.Function &&
                    symbol.name === functionName &&
                    symbol.range.contains(ref.range.start)
                ) {
                    return new vscode.Location(ref.uri, symbol.selectionRange.start)
                }
            }
        }

        // If no declaration found, use the first reference
        return references[0]
    } catch (error) {
        console.error("Error finding declaration location:", error)
        return null
    }
}

/**
 * Check if a function is exported
 */
async function isFunctionExported(
    fileUri: vscode.Uri,
    position: vscode.Position,
    functionName: string,
    languageId: string,
): Promise<boolean> {
    if (languageId === "go") {
        // In Go, exported functions start with uppercase letter
        return functionName[0] === functionName[0].toUpperCase()
    } else if (languageId === "typescript" || languageId === "typescriptreact") {
        // In TypeScript, check if the function has 'export' keyword
        const document = await vscode.workspace.openTextDocument(fileUri)
        const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
            "vscode.executeDocumentSymbolProvider",
            fileUri,
        )

        if (!symbols) {
            return false
        }

        // Find the function symbol
        for (const symbol of symbols) {
            if (
                symbol.kind === vscode.SymbolKind.Function &&
                symbol.name === functionName &&
                symbol.range.contains(position)
            ) {
                // Check if the line contains 'export' keyword before the function
                const line = document.lineAt(symbol.range.start.line).text
                return /^\s*export\s+/.test(line)
            }
        }
    }

    return false
}

/**
 * Find Go references for a TypeScript function
 */
async function findGoReferencesForFunction(
    tsFileUri: vscode.Uri,
    functionName: string,
    isSourceExported: boolean,
): Promise<vscode.Location[]> {
    // Find Go files in the same directory
    const goFiles = await findGoFilesInSameDirectory(tsFileUri)
    if (goFiles.length === 0) {
        return []
    }

    // Try both original name and capitalized
    const capitalizedName = capitalizeFirstLetter(functionName)
    const searchNames = functionName === capitalizedName
        ? [functionName]
        : [capitalizedName, functionName]

    return await findFunctionInGoFiles(goFiles, searchNames, isSourceExported)
}

/**
 * Find TypeScript references for a Go function
 */
async function findTsReferencesForFunction(
    goFileUri: vscode.Uri,
    functionName: string,
    isSourceExported: boolean,
): Promise<vscode.Location[]> {
    // Find TypeScript files in the same directory
    const tsFiles = await findTsFilesInSameDirectory(goFileUri)
    if (tsFiles.length === 0) {
        return []
    }

    // Try both original name and lowercase first letter
    const lowercasedName = lowercaseFirstLetter(functionName)
    const searchNames = functionName === lowercasedName
        ? [functionName]
        : [lowercasedName, functionName]

    return await findFunctionInTsFiles(tsFiles, searchNames, isSourceExported)
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
 * Find function references in Go files
 */
async function findFunctionInGoFiles(
    goFiles: vscode.Uri[],
    functionNames: string[],
    isSourceExported: boolean,
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
                if (
                    symbol.kind === vscode.SymbolKind.Function &&
                    functionNames.includes(symbol.name) &&
                    isTopLevelFunction(symbol, symbols)
                ) {
                    const isGoExported = symbol.name[0] === symbol.name[0].toUpperCase()

                    // Check accessibility if strict mode is enabled
                    if (strictAccessibility && isSourceExported !== isGoExported) {
                        continue
                    }

                    // Calculate priority
                    // 0 = accessibility match (best)
                    // 1 = exact name match
                    // 2 = any match (default)
                    const exactName = symbol.name === functionNames[0] // First name is the original
                    const sameAccessibility = isSourceExported === isGoExported

                    let priority = 2 // Default: any match
                    if (sameAccessibility) {
                        priority = 0 // Best: accessibility match
                    } else if (exactName) {
                        priority = 1 // Second: exact name match
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
 * Find function references in TypeScript files
 */
async function findFunctionInTsFiles(
    tsFiles: vscode.Uri[],
    functionNames: string[],
    isSourceExported: boolean,
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
                if (
                    symbol.kind === vscode.SymbolKind.Function &&
                    functionNames.includes(symbol.name) &&
                    isTopLevelFunction(symbol, symbols)
                ) {
                    // Check if TypeScript function is exported
                    const line = document.lineAt(symbol.range.start.line).text
                    const isTsExported = /^\s*export\s+/.test(line)

                    // Check accessibility if strict mode is enabled
                    if (strictAccessibility && isSourceExported !== isTsExported) {
                        continue
                    }

                    // Calculate priority
                    // 0 = accessibility match (best)
                    // 1 = exact name match
                    // 2 = any match (default)
                    const exactName = symbol.name === functionNames[0] // First name is the original
                    const sameAccessibility = isSourceExported === isTsExported

                    let priority = 2 // Default: any match
                    if (sameAccessibility) {
                        priority = 0 // Best: accessibility match
                    } else if (exactName) {
                        priority = 1 // Second: exact name match
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
