import * as vscode from "vscode"
import { BilingoImplementationProvider } from "./implementation/provider"
import { BilingoReferenceProvider } from "./reference/provider"

export function activate(context: vscode.ExtensionContext) {
    console.log("Bilingo VSCode Extension is now active!")

    // Create and register the reference provider
    const referenceProvider = new BilingoReferenceProvider()

    // Register reference provider for TypeScript and Go
    // This makes "Find All References" work across TypeScript and Go
    const tsReferenceProvider = vscode.languages.registerReferenceProvider(
        [{ language: "typescript" }, { language: "typescriptreact" }],
        referenceProvider,
    )
    const goReferenceProvider = vscode.languages.registerReferenceProvider(
        { language: "go" },
        referenceProvider,
    )

    // Create and register the implementation provider
    const implementationProvider = new BilingoImplementationProvider()

    // Register implementation provider for TypeScript and Go
    // This makes "Find All Implementations" work across TypeScript and Go
    const tsImplementationProvider = vscode.languages.registerImplementationProvider(
        [{ language: "typescript" }, { language: "typescriptreact" }],
        implementationProvider,
    )
    const goImplementationProvider = vscode.languages.registerImplementationProvider(
        { language: "go" },
        implementationProvider,
    )

    context.subscriptions.push(
        tsReferenceProvider,
        goReferenceProvider,
        tsImplementationProvider,
        goImplementationProvider,
    )
}

export function deactivate() {
    console.log("Bilingo VSCode Extension is now deactivated!")
}
