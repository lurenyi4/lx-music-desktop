// Check the same inline TypeScript templates used by vue-loader's production build.
// Optional argument: a Git revision for reproducing an earlier failure.
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync, spawnSync } = require('node:child_process')
const { parse, compileScript } = require('@vue/compiler-sfc')
const root = path.resolve(__dirname, '..')
const directory = fs.mkdtempSync(path.join(__dirname, '.search-inline-'))
try {
  for (const file of ['src/renderer/views/Search/MusicList/index.vue', 'src/renderer/views/Search/SongListList/index.vue']) {
    const source = process.argv[2] ? execFileSync('git', ['show', `${process.argv[2]}:${file}`], { cwd: root, encoding: 'utf8' }) : fs.readFileSync(path.join(root, file), 'utf8')
    const { descriptor } = parse(source, { filename: file })
    const id = path.basename(path.dirname(file))
    fs.writeFileSync(path.join(directory, `${id}.ts`), compileScript(descriptor, { id, inlineTemplate: true }).content.replaceAll("'./useList'", `"@renderer/views/Search/${id}/useList"`))
  }
  const project = path.join(directory, 'tsconfig.json')
  fs.writeFileSync(project, JSON.stringify({ extends: path.join(root, 'src/renderer/tsconfig.json'), compilerOptions: { typeRoots: [path.join(root, 'src/renderer/types'), path.join(root, 'node_modules/@types')], types: ['node'] }, include: ['./*.ts', path.join(root, 'src/common/types/**/*.d.ts'), path.join(root, 'src/renderer/types/**/*.d.ts')], exclude: [path.join(root, 'node_modules'), path.join(root, 'src/**/*.test.ts')] }))
  const result = spawnSync(process.execPath, [require.resolve('typescript/bin/tsc'), '--noEmit', '-p', project], { cwd: root, stdio: 'inherit' })
  process.exitCode = result.status ?? 1
} finally {
  fs.rmSync(directory, { recursive: true, force: true })
}
