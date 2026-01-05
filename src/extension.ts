import * as vscode from "vscode"
import { BilingoReferenceProvider } from "./referenceProvider"

export function activate(context: vscode.ExtensionContext) {
    console.log("Bilingo VSCode Extension is now active!")

    // Create and register the reference provider
    const referenceProvider = new BilingoReferenceProvider()

    // Register reference provider for TypeScript and Go
    // This makes "Find All References" work across TypeScript and Go
    const tsProvider = vscode.languages.registerReferenceProvider(
        [{ language: "typescript" }, { language: "typescriptreact" }],
        referenceProvider,
    )
    const goProvider = vscode.languages.registerReferenceProvider(
        { language: "go" },
        referenceProvider,
    )

    context.subscriptions.push(
        tsProvider,
        goProvider,
    )
}

export function deactivate() {
    console.log("Bilingo VSCode Extension is now deactivated!")
}
