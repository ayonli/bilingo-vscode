import * as vscode from "vscode"
import { isEnabledInWorkspace } from "../config"
import { getFunctionNameAtPosition } from "../utils"
import { findImplementations } from "./finder"

// Global flag to prevent recursive calls across all instances
let isProcessingGlobal = false

/**
 * Implementation provider for cross-language implementations
 */
export class BilingoImplementationProvider implements vscode.ImplementationProvider {
    async provideImplementation(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
    ): Promise<vscode.Definition | vscode.LocationLink[] | null> {
        // Prevent recursive calls using global flag
        if (isProcessingGlobal) {
            return null
        }

        // Check if enabled
        if (!isEnabledInWorkspace()) {
            return null
        }

        const languageId = document.languageId

        // Only handle TypeScript and Go files
        if (
            languageId !== "typescript" && languageId !== "typescriptreact" &&
            languageId !== "go"
        ) {
            return null
        }

        isProcessingGlobal = true
        try {
            const allImplementations: vscode.Location[] = []

            // Track known declaration info for passing to findImplementations
            let knownDeclaration:
                | { location: vscode.Location; kind: vscode.SymbolKind; name: string }
                | undefined = undefined

            // For Go, we need to find the current language declaration
            // because gopls doesn't have the same implementation provider behavior as TypeScript
            if (languageId === "go") {
                // Get the symbol name at cursor
                const symbolName = getFunctionNameAtPosition(document, position)
                if (symbolName) {
                    // Try to find the declaration in the current file using document symbols
                    // This is more reliable for structs
                    const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
                        "vscode.executeDocumentSymbolProvider",
                        document.uri,
                    )

                    if (symbols) {
                        // Look for a symbol at the current position (for declarations)
                        const currentSymbol = this.findSymbolAtCursor(symbols, position)
                        if (
                            currentSymbol &&
                            (currentSymbol.kind === vscode.SymbolKind.Function ||
                                currentSymbol.kind === vscode.SymbolKind.Struct ||
                                currentSymbol.kind === vscode.SymbolKind.Interface) &&
                            currentSymbol.name === symbolName
                        ) {
                            // Found declaration in current position
                            const declLocation = new vscode.Location(
                                document.uri,
                                currentSymbol.selectionRange.start,
                            )
                            allImplementations.push(declLocation)
                            knownDeclaration = {
                                location: declLocation,
                                kind: currentSymbol.kind,
                                name: symbolName,
                            }
                        }
                    }

                    // If not found in current position, use definition provider to find declaration
                    // This is more reliable for finding declaration from usage sites
                    if (!knownDeclaration) {
                        const definitions = await vscode.commands.executeCommand<vscode.Location[]>(
                            "vscode.executeDefinitionProvider",
                            document.uri,
                            position,
                        )

                        if (definitions && definitions.length > 0) {
                            // Get the first definition (usually the declaration)
                            const def = definitions[0]
                            const defSymbols = await vscode.commands.executeCommand<
                                vscode.DocumentSymbol[]
                            >(
                                "vscode.executeDocumentSymbolProvider",
                                def.uri,
                            )

                            if (defSymbols) {
                                // Find the symbol at the definition location
                                const defSymbol = this.findSymbolAtCursor(
                                    defSymbols,
                                    def.range.start,
                                )
                                if (
                                    defSymbol &&
                                    (defSymbol.kind === vscode.SymbolKind.Function ||
                                        defSymbol.kind === vscode.SymbolKind.Struct ||
                                        defSymbol.kind === vscode.SymbolKind.Interface)
                                ) {
                                    const declLocation = new vscode.Location(
                                        def.uri,
                                        defSymbol.selectionRange.start,
                                    )
                                    allImplementations.push(declLocation)
                                    knownDeclaration = {
                                        location: declLocation,
                                        kind: defSymbol.kind,
                                        name: defSymbol.name,
                                    }
                                } else {
                                    // Fallback: use the definition location directly
                                    allImplementations.push(def)
                                }
                            }
                        }
                    }
                }
            } else {
                // For TypeScript, use the native implementation provider
                const nativeImplementations = await vscode.commands.executeCommand<
                    vscode.Location[]
                >(
                    "vscode.executeImplementationProvider",
                    document.uri,
                    position,
                )

                if (nativeImplementations && nativeImplementations.length > 0) {
                    allImplementations.push(...nativeImplementations)
                }
            }

            // Find cross-language implementations
            const crossLanguageImplementations = await findImplementations(
                document,
                position,
                token,
                knownDeclaration,
            )

            if (crossLanguageImplementations.length > 0) {
                allImplementations.push(...crossLanguageImplementations)
            }

            return allImplementations.length > 0 ? allImplementations : null
        } catch (error) {
            console.error("Error finding cross-language implementations:", error)
            return null
        } finally {
            isProcessingGlobal = false
        }
    }

    /**
     * Find a symbol (function/struct/interface) at the cursor position
     */
    private findSymbolAtCursor(
        symbols: vscode.DocumentSymbol[],
        position: vscode.Position,
    ): vscode.DocumentSymbol | null {
        for (const symbol of symbols) {
            // Check if the position is within this symbol's selectionRange (the symbol name)
            if (symbol.selectionRange.contains(position)) {
                return symbol
            }

            // Recursively search in children
            if (symbol.children && symbol.children.length > 0) {
                const found = this.findSymbolAtCursor(symbol.children, position)
                if (found) {
                    return found
                }
            }
        }

        return null
    }
}
