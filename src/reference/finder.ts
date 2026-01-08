import * as vscode from "vscode"
import { isStrictAccessibilityEnabled } from "../config"
import {
    capitalizeFirstLetter,
    findCorrespondingField,
    findCorrespondingInterface,
    findCorrespondingInterfaceMethod,
    findGoFilesInSameDirectory,
    findMatchingSymbolsInGoFiles,
    findMatchingSymbolsInTsFiles,
    findTsFilesInSameDirectory,
    getEnumConstInfoAtPosition,
    getEnumTypeInfoAtPosition,
    getFieldInfoAtPosition,
    getInterfaceInfoAtPosition,
    getInterfaceMethodInfoAtPosition,
    getSymbolInfoAtPosition,
    isGoEnumConst,
    isTsEnumConst,
    lowercaseFirstLetter,
} from "../utils"

/**
 * Remove duplicate locations from an array of vscode.Location objects.
 * Locations are considered duplicates if they point to the same file and position.
 */
function getUniqueLocations(locations: vscode.Location[]): vscode.Location[] {
    return locations.filter((loc, index, self) =>
        index === self.findIndex((l) =>
            l.uri.fsPath === loc.uri.fsPath &&
            l.range.start.line === loc.range.start.line &&
            l.range.start.character === loc.range.start.character
        )
    )
}

/**
 * Find cross-language references for TypeScript and Go.
 * Only returns references from the OTHER language, not the current language.
 */
export async function findReferences(
    document: vscode.TextDocument,
    position: vscode.Position,
    _context: vscode.ReferenceContext,
    _token: vscode.CancellationToken,
): Promise<vscode.Location[]> {
    const languageId = document.languageId

    // First, check if cursor is on an enum type
    const enumTypeInfo = await getEnumTypeInfoAtPosition(document, position)

    if (enumTypeInfo) {
        // Handle enum type references
        return await findEnumTypeReferences(enumTypeInfo, languageId)
    }

    // Second, check if cursor is on a enum constant
    const constConstInfo = await getEnumConstInfoAtPosition(document, position)

    if (constConstInfo) {
        // Handle enum constant references
        return await findEnumConstReferences(constConstInfo, languageId)
    }

    // Third, check if cursor is on an interface (the interface itself, not members)
    const interfaceInfo = await getInterfaceInfoAtPosition(document, position)

    if (interfaceInfo) {
        // Handle interface references
        return await findInterfaceReferences(interfaceInfo, languageId)
    }

    // Fourth, check if cursor is on an interface method
    const methodInfo = await getInterfaceMethodInfoAtPosition(document, position)

    if (methodInfo) {
        // Handle interface method references
        return await findInterfaceMethodReferences(methodInfo, languageId)
    }

    // Fifth, check if cursor is on a field/property
    const fieldInfo = await getFieldInfoAtPosition(document, position)

    if (fieldInfo) {
        // Handle field/property references
        return await findFieldReferences(fieldInfo, languageId)
    }

    // Sixth, handle function/struct/interface references
    const symbolInfo = await getSymbolInfoAtPosition(document, position)

    if (symbolInfo) {
        // Handle function/struct/interface references
        return await findSymbolReferences(symbolInfo, languageId)
    }

    return []
}

/**
 * Find cross-language references for a enum constant.
 * - For Go const: Find TS export const references.
 * - For TS export const: Find Go const references.
 */
async function findEnumConstReferences(
    constantInfo: import("../utils").EnumConstInfo,
    sourceLanguage: string,
): Promise<vscode.Location[]> {
    const constantName = constantInfo.name

    // Find the corresponding enum constant in the other language
    if (sourceLanguage === "go") {
        // From Go, find TypeScript constant references
        const tsFiles = await findTsFilesInSameDirectory(constantInfo.fileUri)
        if (tsFiles.length === 0) {
            return []
        }

        return await findTsEnumConstReferences(tsFiles, constantName)
    } else if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // From TypeScript, find Go constant references
        const goFiles = await findGoFilesInSameDirectory(constantInfo.fileUri)
        if (goFiles.length === 0) {
            return []
        }

        return await findGoEnumConstReferences(goFiles, constantName)
    }

    return []
}

/**
 * Find cross-language references for an enum type.
 * - For Go type: Find TS export type references.
 * - For TS export type: Find Go type references.
 */
async function findEnumTypeReferences(
    typeInfo: import("../utils").EnumTypeInfo,
    sourceLanguage: string,
): Promise<vscode.Location[]> {
    const typeName = typeInfo.name

    // Find the corresponding type in the other language
    if (sourceLanguage === "go") {
        // From Go, find TypeScript type references
        const tsFiles = await findTsFilesInSameDirectory(typeInfo.fileUri)
        if (tsFiles.length === 0) {
            return []
        }

        return await findTsEnumTypeReferences(tsFiles, typeName)
    } else if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // From TypeScript, find Go type references
        const goFiles = await findGoFilesInSameDirectory(typeInfo.fileUri)
        if (goFiles.length === 0) {
            return []
        }

        return await findGoEnumTypeReferences(goFiles, typeName)
    }

    return []
}

/**
 * Find TypeScript enum constant references for a Go enum constant.
 */
async function findTsEnumConstReferences(
    tsFiles: vscode.Uri[],
    constName: string,
): Promise<vscode.Location[]> {
    const allLocations: vscode.Location[] = []

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
                // Match export const with same name and uppercase first letter
                if (
                    (symbol.kind === vscode.SymbolKind.Constant ||
                        symbol.kind === vscode.SymbolKind.Variable) &&
                    symbol.name === constName &&
                    symbol.name[0] === symbol.name[0].toUpperCase()
                ) {
                    // Check if the constant has a valid type
                    if (!isTsEnumConst(document, symbol)) {
                        continue
                    }

                    // Get references for this constant
                    const references = await vscode.commands.executeCommand<vscode.Location[]>(
                        "vscode.executeReferenceProvider",
                        tsFile,
                        symbol.selectionRange.start,
                    )

                    if (references) {
                        allLocations.push(...references)
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return getUniqueLocations(allLocations)
}

/**
 * Find Go enum constant references for a TypeScript enum constant.
 */
async function findGoEnumConstReferences(
    goFiles: vscode.Uri[],
    constName: string,
): Promise<vscode.Location[]> {
    const allLocations: vscode.Location[] = []

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
                // Match const with same name and uppercase first letter
                if (
                    symbol.kind === vscode.SymbolKind.Constant &&
                    symbol.name === constName &&
                    symbol.name[0] === symbol.name[0].toUpperCase()
                ) {
                    // Check if the constant has a valid type
                    const document = await vscode.workspace.openTextDocument(goFile)
                    if (!isGoEnumConst(document, symbol)) {
                        continue
                    }

                    // Get references for this constant
                    const references = await vscode.commands.executeCommand<vscode.Location[]>(
                        "vscode.executeReferenceProvider",
                        goFile,
                        symbol.selectionRange.start,
                    )

                    if (references) {
                        allLocations.push(...references)
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return getUniqueLocations(allLocations)
}

/**
 * Find Go enum type references for a TypeScript enum type.
 */
async function findGoEnumTypeReferences(
    goFiles: vscode.Uri[],
    typeName: string,
): Promise<vscode.Location[]> {
    const allLocations: vscode.Location[] = []

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
                // Match type alias with same name and uppercase first letter
                // In Go, type aliases might show up as Class or Interface in the symbol tree
                if (
                    (symbol.kind === vscode.SymbolKind.Class ||
                        symbol.kind === vscode.SymbolKind.Interface) &&
                    symbol.name === typeName &&
                    symbol.name[0] === symbol.name[0].toUpperCase()
                ) {
                    // Verify it's a type alias (type Status = string/int/bool/etc)
                    const document = await vscode.workspace.openTextDocument(goFile)
                    const line = document.lineAt(symbol.range.start.line).text

                    // Check for pattern: type TypeName = string/int/bool/etc
                    if (
                        /type\s+\w+\s*=\s*(string|int\d*|uint\d*|float\d+|bool|byte|rune)/.test(
                            line,
                        )
                    ) {
                        // Get references for this type
                        const references = await vscode.commands.executeCommand<vscode.Location[]>(
                            "vscode.executeReferenceProvider",
                            goFile,
                            symbol.selectionRange.start,
                        )

                        if (references) {
                            allLocations.push(...references)
                        }
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing Go file ${goFile.fsPath}:`, error)
        }
    }

    return getUniqueLocations(allLocations)
}

/**
 * Find TypeScript enum type references for a Go enum type.
 */
async function findTsEnumTypeReferences(
    tsFiles: vscode.Uri[],
    typeName: string,
): Promise<vscode.Location[]> {
    const allLocations: vscode.Location[] = []

    for (const tsFile of tsFiles) {
        try {
            const document = await vscode.workspace.openTextDocument(tsFile)

            // Look for: export type Status = ...
            const typeDefPattern = new RegExp(`export\\s+type\\s+${typeName}\\s*=`)

            for (let lineIndex = 0; lineIndex < document.lineCount; lineIndex++) {
                const line = document.lineAt(lineIndex).text

                if (typeDefPattern.test(line)) {
                    // Found the type definition start, check if it contains typeof pattern
                    // (could be on the next line due to code formatter)
                    let foundTypeofPattern = false
                    const typeofPattern = new RegExp(`typeof\\s+${typeName}[A-Z]`)

                    // Check current line first
                    if (typeofPattern.test(line)) {
                        foundTypeofPattern = true
                    } else if (lineIndex + 1 < document.lineCount) {
                        // Check next line - formatter might put union types on next line
                        // Could be: | typeof ... or typeof ... |
                        const nextLine = document.lineAt(lineIndex + 1).text
                        if (
                            typeofPattern.test(nextLine) &&
                            (/^\s*\|/.test(nextLine) || /\|\s*$/.test(nextLine))
                        ) {
                            foundTypeofPattern = true
                        }
                    }

                    if (foundTypeofPattern) {
                        // Found the type definition, get references from this position
                        // Use the position of the type name in the line
                        const typeNameIndex = line.indexOf(` ${typeName} `)
                        if (typeNameIndex === -1) { continue }

                        const position = new vscode.Position(lineIndex, typeNameIndex + 1)
                        const references = await vscode.commands.executeCommand<vscode.Location[]>(
                            "vscode.executeReferenceProvider",
                            tsFile,
                            position,
                        )

                        if (references) {
                            allLocations.push(...references)
                        }
                        break // Only one type definition per file
                    }
                }
            }
        } catch (error) {
            console.error(`Error processing TS file ${tsFile.fsPath}:`, error)
        }
    }

    return getUniqueLocations(allLocations)
}

/**
 * Find cross-language references for a field/property.
 * - For Go struct field: Find TS interface property references.
 * - For TS interface property: Find Go struct field references.
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
 * Find cross-language references for an interface (the interface itself).
 * - For Go interface: Find TS interface (with methods) references.
 * - For TS interface (with methods): Find Go interface references.
 * - For TS interface (without methods): Find Go struct references.
 */
async function findInterfaceReferences(
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

    // Get references for the corresponding interface
    try {
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            correspondingInterface.fileUri,
            correspondingInterface.symbol.selectionRange.start,
        )

        return references || []
    } catch (error) {
        console.error("Error finding interface references:", error)
        return []
    }
}

/**
 * Find cross-language references for an interface method.
 * - For Go interface method: Find TS interface method references.
 * - For TS interface method: Find Go interface method references.
 */
async function findInterfaceMethodReferences(
    methodInfo: import("../utils").InterfaceMethodInfo,
    sourceLanguage: string,
): Promise<vscode.Location[]> {
    // Find the corresponding method in the other language
    const correspondingMethod = await findCorrespondingInterfaceMethod(
        methodInfo,
        sourceLanguage,
    )

    if (!correspondingMethod) {
        return []
    }

    // Get references for the corresponding method
    try {
        const references = await vscode.commands.executeCommand<vscode.Location[]>(
            "vscode.executeReferenceProvider",
            correspondingMethod.fileUri,
            correspondingMethod.methodSymbol.selectionRange.start,
        )

        return references || []
    } catch (error) {
        console.error("Error finding interface method references:", error)
        return []
    }
}

/**
 * Find cross-language references for a symbol (function/struct/interface).
 * - For Go function: Find TS function references.
 * - For TS function: Find Go function references.
 * - For Go struct: Find TS interface references.
 * - For TS interface: Find Go struct references.
 * - For Go interface: Find TS interface/type alias references.
 * - For TS type alias: Find Go interface references.
 */
async function findSymbolReferences(
    symbolInfo: import("../utils").SymbolInfo,
    sourceLanguage: string,
): Promise<vscode.Location[]> {
    if (sourceLanguage === "typescript" || sourceLanguage === "typescriptreact") {
        // From TypeScript, find Go references ONLY
        return await findGoReferences(
            symbolInfo.location.uri,
            symbolInfo.name,
            symbolInfo.isExported,
            symbolInfo.kind,
        )
    } else if (sourceLanguage === "go") {
        // From Go, find TypeScript references ONLY
        return await findTsReferences(
            symbolInfo.location.uri,
            symbolInfo.name,
            symbolInfo.isExported,
            symbolInfo.kind,
        )
    }

    return []
}

/**
 * Find Go references for a TypeScript symbol.
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

    return await findSymbolReferencesInGoFiles(goFiles, searchNames, isSourceExported, symbolKind)
}

/**
 * Find TypeScript references for a Go symbol.
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

    return await findSymbolReferencesInTsFiles(tsFiles, searchNames, isSourceExported, symbolKind)
}

/**
 * Find symbol references in Go files (functions, structs).
 */
async function findSymbolReferencesInGoFiles(
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

    return getUniqueLocations(allLocations)
}

/**
 * Find symbol references in TypeScript files (functions, interfaces).
 */
async function findSymbolReferencesInTsFiles(
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

    return getUniqueLocations(allLocations)
}
