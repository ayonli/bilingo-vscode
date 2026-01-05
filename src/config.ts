import * as vscode from "vscode"

/**
 * Check if Bilingo is enabled for the current workspace
 */
export function isEnabledInWorkspace(): boolean {
    const config = vscode.workspace.getConfiguration("bilingo-vscode")
    const enabled = config.get<boolean>("enable", true)
    return enabled
}

/**
 * Check if strict accessibility matching is enabled
 */
export function isStrictAccessibilityEnabled(): boolean {
    const config = vscode.workspace.getConfiguration("bilingo-vscode")
    const strictAccessibility = config.get<boolean>("strictAccessibility", false)
    return strictAccessibility
}

/**
 * Get all workspace folders
 */
export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return []
    }

    return workspaceFolders
}
