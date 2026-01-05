import * as vscode from "vscode"

/**
 * Get the function name at the given position
 * This can be either:
 * 1. A function being called (e.g., cursor on "getArticle" in "getArticle()")
 * 2. A function declaration (e.g., cursor on function name in "function getArticle()")
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
 * Extract function name from text at position (fallback method)
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
 * Capitalize the first letter of a string
 */
export function capitalizeFirstLetter(str: string): string {
    if (!str) { return str }
    return str.charAt(0).toUpperCase() + str.slice(1)
}

/**
 * Lowercase the first letter of a string
 */
export function lowercaseFirstLetter(str: string): string {
    if (!str) { return str }
    return str.charAt(0).toLowerCase() + str.slice(1)
}
