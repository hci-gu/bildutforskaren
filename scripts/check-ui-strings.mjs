// Report app-owned JSX text that bypasses the translation layer.
import ts from '../web/node_modules/typescript/lib/typescript.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name)
    return entry.isDirectory() ? filesUnder(file) : /\.tsx$/.test(file) && !file.includes('.test.') ? [file] : []
  })
}
const allowed = new Set(['Bildutforskaren', 'Svenska', 'English', 'A', 'B', 'A ·', 'B ·', 'SDXL', 'IP-Adapter', 'Metadata.xlsx', 'CLIP', 'UMAP', '2D', '3D', 'DBSCAN', 'HDBSCAN', 'K-means', 'Epsilon', 'R²', 'rad', 't=', 'topK'])
const findings = []
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const file of filesUnder(path.join(root, 'web/src')).filter(file => !file.includes(`${path.sep}i18n${path.sep}`))) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  function report(node, value) {
    value = value.replace(/\s+/g, ' ').trim()
    if (!/[a-zåäö]/i.test(value) || allowed.has(value)) return
    findings.push(`${file}:${source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1}: ${value}`)
  }
  function visit(node) {
    if (ts.isJsxText(node)) report(node, node.text)
    if (ts.isJsxAttribute(node)) {
      if (!['title', 'placeholder', 'aria-label', 'alt', 'label', 'description', 'errorText', 'loadingText'].includes(node.name.text)) return
      if (node.initializer && ts.isStringLiteral(node.initializer)) report(node, node.initializer.text)
    }
    if (ts.isCallExpression(node) && ['t', 'translate', 'message', 'displayLabel', 'displayTag', 'scopeNote', 'renderMessage', 'plural', 'formatNumber', 'formatDate', 'canvasText'].includes(node.expression.getText(source))) return
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) && node.parent && !ts.isJsxAttribute(node.parent)) {
      if (ts.isBinaryExpression(node.parent) && ['===', '!==', '==', '!='].includes(node.parent.operatorToken.getText(source))) return
      if (ts.isArrayLiteralExpression(node.parent)) return
      let inJsx = false
      for (let parent = node.parent; parent; parent = parent.parent) {
        if (ts.isJsxExpression(parent)) inJsx = true
        if (ts.isJsxAttribute(parent) || ts.isStatement(parent)) { inJsx = false; break }
        if (ts.isJsxElement(parent)) break
      }
      if (inJsx) report(node, node.text)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}
console.log(findings.length ? findings.join('\n') : 'No untranslated app-owned JSX literals found.')
process.exitCode = findings.length ? 1 : 0
