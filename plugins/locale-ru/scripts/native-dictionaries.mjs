/** Read native dictionary literals without executing product plugins. */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { dshRoot } from '../../../scripts/dsh-root.mjs'

const ts = createRequire(join(dshRoot(), 'package.json'))('typescript')

function evaluate(node, file) {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) return evaluate(node.left, file) + evaluate(node.right, file)
  if (ts.isArrayLiteralExpression(node)) return node.elements.map(element => evaluate(element, file))
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === 'join') return evaluate(node.expression.expression, file).join(evaluate(node.arguments[0], file))
  if (ts.isObjectLiteralExpression(node)) {
    const dict = {}
    for (const property of node.properties) {
      if (ts.isSpreadAssignment(property)) Object.assign(dict, evaluate(property.expression, file))
      else if (ts.isShorthandPropertyAssignment(property)) dict[property.name.text] = readSymbol(file, property.name.text)
      else if (ts.isPropertyAssignment(property)) dict[property.name.text] = evaluate(property.initializer, file)
      else throw new Error(`Unsupported dictionary property in ${file}: ${property.getText()}`)
    }
    return dict
  }
  if (ts.isIdentifier(node)) return readSymbol(file, node.text)
  throw new Error(`Unsupported dictionary literal in ${file}: ${node.getText()}`)
}

const parsed = new Map()
function parse(file) {
  if (!parsed.has(file)) parsed.set(file, ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true))
  return parsed.get(file)
}

function readSymbol(file, name) {
  const ast = parse(file)
  let result
  let found = false
  const visit = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      result = evaluate(node.initializer, file)
      found = true
    }
    ts.forEachChild(node, visit)
  }
  visit(ast)
  if (found) return result
  for (const statement of ast.statements) {
    if (!statement.moduleSpecifier) continue
    const bindings = ts.isImportDeclaration(statement) ? statement.importClause?.namedBindings : statement.exportClause
    if (!bindings || !(ts.isNamedImports(bindings) || ts.isNamedExports(bindings))) continue
    const binding = bindings.elements.find(element => element.name.text === name)
    if (binding) return readSymbol(resolve(dirname(file), statement.moduleSpecifier.text), binding.propertyName?.text ?? name)
  }
  throw new Error(`Dictionary symbol ${name} is missing in ${file}`)
}

/**
 * Extract dictionaries contributed through native locale registrations.
 * @param {string} root - checked-out DSH source root.
 * @returns {Record<string, Record<string, string>>} namespace dictionaries.
 */
export function nativeDictionaries(root) {
  const dictionaries = {}
  const walk = dir => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = join(dir, entry.name)
      if (entry.isDirectory()) walk(file)
      else if (/\.tsx?$/.test(entry.name) && readFileSync(file, 'utf8').includes('.locale.register(')) {
        const visit = node => {
          if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
            && node.expression.name.text === 'register' && node.expression.expression.getText().endsWith('.locale')
            && node.arguments.length === 2) {
            const namespace = evaluate(node.arguments[0], file)
            const dictionary = evaluate(node.arguments[1], file).en
            if (!dictionary) throw new Error(`Missing native English dictionary: ${namespace}`)
            dictionaries[namespace] = dictionary
          }
          ts.forEachChild(node, visit)
        }
        visit(parse(file))
      }
    }
  }
  for (const group of readdirSync(join(root, 'packages'), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
    for (const pkg of readdirSync(join(root, 'packages', group.name), { withFileTypes: true }).filter(entry => entry.isDirectory())) {
      const dir = join(root, 'packages', group.name, pkg.name)
      if (readdirSync(dir).includes('src')) walk(join(dir, 'src'))
    }
  }
  dictionaries.common = readSymbol(join(root, 'packages/client/locale/src/locales/en.ts'), 'en')
  dictionaries['settings.locale'] = readSymbol(join(root, 'packages/client/locale/src/locales/settings.ts'), 'en')
  dictionaries['directory-browser'] = readSymbol(join(root, 'packages/client/ui-directory-picker-browse/src/client/index.ts'), 'dictionaries')[1][1]
  return dictionaries
}
