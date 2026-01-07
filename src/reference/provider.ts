import * as vscode from "vscode"
import { isEnabledInWorkspace } from "../config"
import { findReferences } from "./finder"

// Global flag to prevent recursive calls across all instances
let isProcessingGlobal = false

/**
 * Reference provider for cross-language references.
 */
export class BilingoReferenceProvider implements vscode.ReferenceProvider {
    async provideReferences(
        document: vscode.TextDocument,
        position: vscode.Position,
        context: vscode.ReferenceContext,
        token: vscode.CancellationToken,
    ): Promise<vscode.Location[] | null> {
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
            // Find cross-language references
            const references = await findReferences(
                document,
                position,
                context,
                token,
            )
            return references
        } catch (error) {
            console.error("Error finding cross-language references:", error)
            return null
        } finally {
            isProcessingGlobal = false
        }
    }
}
