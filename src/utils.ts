import * as vscode from "vscode"
import * as path from "node:path"

/**
 * Get the function name at the given position.
 * This can be either:
 * 1. A function being called (e.g., cursor on "getArticle" in "getArticle()").
 * 2. A function declaration (e.g., cursor on function name in "function getArticle()").
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
 * Find matching symbols in Go files (functions, structs).
 * Returns candidates with score for further processing.
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
 * Find matching symbols in TypeScript files (functions, interfaces).
 * Returns candidates with score for further processing.
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
