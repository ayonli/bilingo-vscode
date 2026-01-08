import * as vscode from "vscode"
import { isStrictExportEnabled } from "../config"
import {
    capitalizeFirstLetter,
    DeclarationInfo,
    findCorrespondingInterface,
    findDeclarationLocationViaReferences,
    findGoFilesInSameDirectory,
    findMatchingSymbolsInGoFiles,
    findMatchingSymbolsInTsFiles,
    findTsFilesInSameDirectory,
    getFunctionNameAtPosition,
    getInterfaceInfoAtPosition,
    isSymbolExported,
    lowercaseFirstLetter,
} from "../utils"

/**
 * Find cross-language implementations (declarations) for TypeScript and Go.
 * Returns the declaration location of the corresponding symbol in the OTHER language.
 * - Go function → TypeScript function declaration
 * - TypeScript function → Go function declaration
 * - Go struct → TypeScript interface declaration
 * - TypeScript interface → Go struct declaration
 * - Go interface (with methods) → TypeScript interface (with methods) declaration
 * - TypeScript interface (with methods) → Go interface (with methods) declaration
 */
export async function findImplementations(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    knownDeclaration?: { location: vscode.Location; kind: vscode.SymbolKind; name: string },
): Promise<vscode.Location[]> {
    const languageId = document.languageId

    // First, check if cursor is on an interface (with methods)
    const interfaceInfo = await getInterfaceInfoAtPosition(document, position)

    if (interfaceInfo && interfaceInfo.hasMethods) {
        // Handle interface (with methods) implementations
        return await findInterfaceImplementations(interfaceInfo, languageId)
    }

    let symbolName: string | null
    let declarationInfo: DeclarationInfo | null

    // Use provided declaration info if available, otherwise find it
    if (knownDeclaration) {
        symbolName = knownDeclaration.name
        declarationInfo = {
            location: knownDeclaration.location,
            kind: knownDeclaration.kind,
        }
    } else {
        // Get the symbol name at cursor
        symbolName = getFunctionNameAtPosition(document, position)
        if (!symbolName) {
            return []
        }

        // Find the declaration location and symbol kind
        declarationInfo = await findDeclarationLocationViaReferences(
            document,
            position,
            symbolName,
        )

        if (!declarationInfo) {
            return []
        }
    }

    // At this point, both should be non-null
    if (!symbolName || !declarationInfo) {
        return []
    }

    const { location: declarationLocation, kind: symbolKind } = declarationInfo

    // Check if the symbol is exported
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

    // Find ONLY cross-language declaration (not current language)
    let implementations: vscode.Location[] = []

    if (languageId === "typescript" || languageId === "typescriptreact") {
        // From TypeScript, find Go declaration
        implementations = await findGoDeclaration(
            declarationLocation.uri,
            symbolName,
            isExported,
            symbolKind,
        )
    } else if (languageId === "go") {
        // From Go, find TypeScript declaration
        implementations = await findTsDeclaration(
            declarationLocation.uri,
            symbolName,
            isExported,
            symbolKind,
        )

        // For Go structs, also find TypeScript interface implementations (classes)
        if (symbolKind === vscode.SymbolKind.Struct && implementations.length > 0) {
            const tsInterfaceImplementations: vscode.Location[] = []

            // For each found TS interface, find its implementations
            for (const tsInterfaceLoc of implementations) {
                const interfaceImpls = await vscode.commands.executeCommand<vscode.Location[]>(
                    "vscode.executeImplementationProvider",
                    tsInterfaceLoc.uri,
                    tsInterfaceLoc.range.start,
                )

                if (interfaceImpls && interfaceImpls.length > 0) {
                    tsInterfaceImplementations.push(...interfaceImpls)
                }
            }

            // Add interface implementations to the result
            if (tsInterfaceImplementations.length > 0) {
                implementations.push(...tsInterfaceImplementations)
            }
        }
    }

    return implementations
}

/**
 * Find Go declaration for a TypeScript symbol.
 */
async function findGoDeclaration(
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

    return await findSymbolDeclarationInGoFiles(goFiles, searchNames, isSourceExported, symbolKind)
}

/**
 * Find TypeScript declaration for a Go symbol.
 */
async function findTsDeclaration(
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

    return await findSymbolDeclarationInTsFiles(tsFiles, searchNames, isSourceExported, symbolKind)
}

/**
 * Find symbol declaration in Go files (functions, structs).
 * Returns only the declaration location, not all references.
 */
async function findSymbolDeclarationInGoFiles(
    goFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    const strictExport = isStrictExportEnabled()

    // Find matching symbols
    const symbolCandidates = await findMatchingSymbolsInGoFiles(
        goFiles,
        symbolNames,
        isSourceExported,
        symbolKind,
        strictExport,
    )

    // If no candidates, return empty
    if (symbolCandidates.length === 0) {
        return []
    }

    // Candidates are already sorted by score (higher is better) from findMatchingSymbolsInGoFiles
    const bestScore = symbolCandidates[0].score

    // Return all declarations with the best score
    return symbolCandidates
        .filter((c) => c.score === bestScore)
        .map((c) => new vscode.Location(c.fileUri, c.symbol.selectionRange.start))
}

/**
 * Find symbol declaration in TypeScript files (functions, interfaces).
 * Returns only the declaration location, not all references.
 */
async function findSymbolDeclarationInTsFiles(
    tsFiles: vscode.Uri[],
    symbolNames: string[],
    isSourceExported: boolean,
    symbolKind: vscode.SymbolKind,
): Promise<vscode.Location[]> {
    const strictExport = isStrictExportEnabled()

    // Find matching symbols
    const symbolCandidates = await findMatchingSymbolsInTsFiles(
        tsFiles,
        symbolNames,
        isSourceExported,
        symbolKind,
        strictExport,
    )

    // If no candidates, return empty
    if (symbolCandidates.length === 0) {
        return []
    }

    // Candidates are already sorted by score (higher is better) from findMatchingSymbolsInTsFiles
    const bestScore = symbolCandidates[0].score

    // Return all declarations with the best score
    return symbolCandidates
        .filter((c) => c.score === bestScore)
        .map((c) => new vscode.Location(c.fileUri, c.symbol.selectionRange.start))
}

/**
 * Find cross-language implementations for an interface (with methods).
 * - For Go interface (with methods): Find TS classes/objects that implement the corresponding TS interface.
 * - For TS interface (with methods): Find Go types/structs that implement the corresponding Go interface.
 */
async function findInterfaceImplementations(
    interfaceInfo: import("../utils").InterfaceInfo,
    sourceLanguage: string,
): Promise<vscode.Location[]> {
    // Find the corresponding interface in the other language
    const correspondingInterface = await findCorrespondingInterface(
        interfaceInfo,
        sourceLanguage,
    )

    if (!correspondingInterface) {
        return []
    }

    const implementations: vscode.Location[] = []

    // Add the interface declaration itself as the first result
    implementations.push(
        new vscode.Location(
            correspondingInterface.fileUri,
            correspondingInterface.symbol.selectionRange.start,
        ),
    )

    // Find implementations of the corresponding interface
    if (sourceLanguage === "go") {
        // Go interface → TS interface → TS implementations (classes)
        const tsImplementations = await findTsInterfaceImplementations(
            correspondingInterface.fileUri,
            correspondingInterface.symbol.selectionRange.start,
        )
        implementations.push(...tsImplementations)
    } else if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // TS interface → Go interface → Go implementations (structs with methods)
        const goImplementations = await findGoInterfaceImplementations(
            correspondingInterface,
        )
        implementations.push(...goImplementations)
    }

    return implementations
}

/**
 * Find TypeScript classes/objects that implement the given interface.
 * Uses VS Code's built-in implementation provider.
 */
async function findTsInterfaceImplementations(
    interfaceUri: vscode.Uri,
    interfacePosition: vscode.Position,
): Promise<vscode.Location[]> {
    try {
        const implementations = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeImplementationProvider",
            interfaceUri,
            interfacePosition,
        )

        return implementations || []
    } catch (error) {
        console.error("Error finding TS interface implementations:", error)
        return []
    }
}

/**
 * Find Go types/structs that implement the given interface.
 * In Go, implementation is implicit, so we need to find types that have all the interface methods.
 */
async function findGoInterfaceImplementations(
    interfaceInfo: import("../utils").InterfaceInfo,
): Promise<vscode.Location[]> {
    try {
        // Use VS Code's implementation provider for Go
        // gopls can find implementations of Go interfaces
        const implementations = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeImplementationProvider",
            interfaceInfo.fileUri,
            interfaceInfo.symbol.selectionRange.start,
        )

        return implementations || []
    } catch (error) {
        console.error("Error finding Go interface implementations:", error)
        return []
    }
}
