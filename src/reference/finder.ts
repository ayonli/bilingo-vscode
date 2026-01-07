import * as vscode from "vscode"
import { isStrictAccessibilityEnabled } from "../config"
import {
    capitalizeFirstLetter,
    findCorrespondingField,
    findDeclarationLocationViaReferences,
    findGoFilesInSameDirectory,
    findMatchingSymbolsInGoFiles,
    findMatchingSymbolsInTsFiles,
    findTsFilesInSameDirectory,
    getFieldInfoAtPosition,
    getFunctionNameAtPosition,
    isSymbolExported,
    lowercaseFirstLetter,
} from "../utils"

/**
 * Find cross-language references for TypeScript and Go
 * Only returns references from the OTHER language, not the current language
 */
export async function findReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    _token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
    const languageId = document.languageId

    // First, check if cursor is on a field/property
    const fieldInfo = await getFieldInfoAtPosition(document, position)

    if (fieldInfo) {
        // Handle field/property references
        return await findFieldReferences(fieldInfo, languageId)
    }

    // Otherwise, handle function/struct/interface references (original logic)
    // Get the symbol name at cursor
    const symbolName = getFunctionNameAtPosition(document, position)
    if (!symbolName) {
        return []
    }

    // Find the declaration location and symbol kind
    const declarationInfo = await findDeclarationLocationViaReferences(
        document,
        position,
        symbolName,
    )

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
    let references: vscode.Location[] = []

    if (languageId === "typescript" || languageId === "typescriptreact") {
        // From TypeScript, find Go references ONLY
        references = await findGoReferences(
            declarationLocation.uri,
            symbolName,
            isExported,
            symbolKind,
        )
    } else if (languageId === "go") {
        // From Go, find TypeScript references ONLY
        references = await findTsReferences(
            declarationLocation.uri,
            symbolName,
            isExported,
            symbolKind,
        )
    }

    // Return ONLY cross-language references
    // Current language references will be provided by the native language server
    return references
}

/**
 * Find cross-language references for a field/property
 * - For Go struct field: Find TS interface property references
 * - For TS interface property: Find Go struct field references
 */
async function findFieldReferences(
    fieldInfo: import("../utils").FieldInfo,
    sourceLanguage: string,
): Promise<vscode.Location[]> {
    // Find the corresponding field in the other language
    const correspondingField = await findCorrespondingField(fieldInfo, sourceLanguage)

    if (!correspondingField) {
        return []
    }

    // Get references for the corresponding field
    try {
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            correspondingField.fileUri,
            correspondingField.fieldSymbol.selectionRange.start,
        )

        return references || []
    } catch (error) {
        console.error("Error finding field references:", error)
        return []
    }
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
 * Find symbol references in Go files (functions, structs)
 */
async function findSymbolInGoFiles(
    goFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    const strictAccessibility = isStrictAccessibilityEnabled()

    // Find matching symbols
    const candidates = await findMatchingSymbolsInGoFiles(
        goFiles,
        symbolNames,
        isSourceExported,
        symbolKind,
        strictAccessibility,
    )

    // If no candidates, return empty
    if (candidates.length === 0) {
        return []
    }

    // Candidates are already sorted by score (higher is better) from findMatchingSymbolsInGoFiles
    const bestScore = candidates[0].score

    // Get all references from candidates with the best score
    const allLocations: vscode.Location[] = []
    for (const candidate of candidates) {
        if (candidate.score !== bestScore) {
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

    // Find matching symbols
    const candidates = await findMatchingSymbolsInTsFiles(
        tsFiles,
        symbolNames,
        isSourceExported,
        symbolKind,
        strictAccessibility,
    )

    // If no candidates, return empty
    if (candidates.length === 0) {
        return []
    }

    // Candidates are already sorted by score (higher is better) from findMatchingSymbolsInTsFiles
    const bestScore = candidates[0].score

    // Get all references from candidates with the best score
    const allLocations: vscode.Location[] = []
    for (const candidate of candidates) {
        if (candidate.score !== bestScore) {
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
