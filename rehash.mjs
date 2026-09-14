#!/usr/bin/env node
// Hernoemt de gebouwde chunks naar hun eigen inhoud.
//
// Deze repo bevat geen bronbestanden, alleen de Vite-output. Wie hier iets wijzigt
// verandert de inhoud van een bestand terwijl de naam blijft staan — en die namen
// worden een jaar gecachet. Dan staat de fix op de server en ziet niemand hem.
//
// De chunks verwijzen naar elkaar (index laadt Home, Home importeert terug naar
// index), dus een hash over de ruwe inhoud bijt zichzelf in de staart: de ene naam
// verandert de andere inhoud. Daarom hashen we de inhoud met alle chunkverwijzingen
// teruggebracht tot hun kale naam. Die vorm is stabiel, dus het loopt in één ronde
// rond en levert bij gelijke inhoud altijd dezelfde naam op.
//
// Draaien na elke wijziging aan assets/*.js of assets/*.css, voor het deployen.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = 'assets'
const HASHED = /^(.+)\.([0-9a-f]{8})\.(js|css)$/

const chunks = readdirSync(ASSETS)
  .map((file) => {
    const m = HASHED.exec(file)
    return m && { file, base: m[1], ext: m[3] }
  })
  .filter(Boolean)

if (chunks.length === 0) {
  console.error('geen gehashte chunks gevonden in ' + ASSETS + '/')
  process.exit(1)
}

// Alles waarin een verwijzing kan staan: de chunks zelf plus de HTML die ze inlaadt.
const carriers = [...chunks.map((c) => join(ASSETS, c.file)), 'index.html']
const read = new Map(carriers.map((p) => [p, readFileSync(p, 'utf8')]))

// `Home.a1b2c3d4.js` -> `Home.js`, zodat de hash niet afhangt van hoe de buren heten.
const strip = (text) =>
  chunks.reduce(
    (acc, c) =>
      acc.replaceAll(
        new RegExp(`${escape(c.base)}\\.[0-9a-f]{8}\\.${c.ext}`, 'g'),
        `${c.base}.${c.ext}`,
      ),
    text,
  )

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const renames = []
for (const c of chunks) {
  const canonical = strip(read.get(join(ASSETS, c.file)))
  const hash = createHash('sha256').update(canonical).digest('hex').slice(0, 8)
  const next = `${c.base}.${hash}.${c.ext}`
  if (next !== c.file) renames.push({ ...c, next })
}

if (renames.length === 0) {
  console.log('niets te doen — elke chunk heet al naar zijn inhoud')
  process.exit(0)
}

// Eerst alle verwijzingen bijwerken, dan pas hernoemen: zo is er geen moment
// waarop een bestand naar een naam wijst die nog niet bestaat.
for (const [path, text] of read) {
  let next = text
  for (const r of renames) {
    next = next.replaceAll(r.file, r.next)
  }
  if (next !== text) writeFileSync(path, next)
}

for (const r of renames) {
  renameSync(join(ASSETS, r.file), join(ASSETS, r.next))
  console.log(`${r.file}  ->  ${r.next}`)
}
