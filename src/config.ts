import * as vscode from "vscode"

/**
 * Check if Bilingo is enabled for the current workspace.
 */
export function isEnabledInWorkspace(): boolean {
    const config = vscode.workspace.getConfiguration("bilingo-vscode")
    const enabled = config.get<boolean>("enable", true)
    return enabled
}

/**
 * Check if strict export matching is enabled.
 * When enabled, only exported functions are matched (Go capitalized + TS exported).
 */
export function isStrictExportEnabled(): boolean {
    const config = vscode.workspace.getConfiguration("bilingo-vscode")
    const strictExport = config.get<boolean>("strictExport", false)
    return strictExport
}

/**
 * Get all workspace folders.
 */
export function getWorkspaceFolders(): readonly vscode.WorkspaceFolder[] {
    const workspaceFolders = vscode.workspace.workspaceFolders
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return []
    }

    return workspaceFolders
}
