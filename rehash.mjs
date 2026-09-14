#!/usr/bin/env node
// Hernoemt de gebouwde chunks zodra hun inhoud wijzigt.
//
// Deze repo bevat geen bronbestanden, alleen de Vite-output. Wie hier iets wijzigt
// verandert de inhoud van een bestand terwijl de naam blijft staan — en die namen
// worden een jaar gecachet. Dan staat de fix op de server en ziet niemand hem.
//
// De chunks verwijzen naar elkaar: index laadt Home, Home importeert terug naar
// index. Per bestand hashen loopt daardoor rond — de naam van de een zit in de
// bytes van de ander, dus een nieuwe naam geeft de buurman nieuwe inhoud, wat hem
// weer een nieuwe naam geeft. Dat convergeert niet.
//
// Daarom krijgen alle chunks samen één build-id: een hash over de inhoud van
// allemaal, met de onderlinge verwijzingen teruggebracht tot hun kale naam zodat
// de berekening niet van de vorige ronde afhangt. Wijzigt er iets, dan verschuift
// alles. Dat hernoemt af en toe een bestand dat zelf niet veranderde, en dat is
// hier de goedkoopste kant van de fout: een handvol bestanden extra opnieuw laden
// weegt niet op tegen een bezoeker die een jaar naar een zwarte pagina kijkt.
//
// Draaien na elke wijziging aan assets/*.js of assets/*.css, voor het deployen.

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs'
import { join } from 'node:path'

const ASSETS = 'assets'
const HASHED = /^(.+)\.([0-9a-f]{8})\.(js|css)$/

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const chunks = readdirSync(ASSETS)
  .map((file) => {
    const m = HASHED.exec(file)
    return m && { file, base: m[1], ext: m[3] }
  })
  .filter(Boolean)
  // Sorteren op de kale naam, niet op het bestand: in de bestandsnaam zit de hash,
  // en zodra die verschuift kantelt de volgorde en daarmee de digest.
  .sort((a, b) => `${a.base}.${a.ext}`.localeCompare(`${b.base}.${b.ext}`))

if (chunks.length === 0) {
  console.error(`geen gehashte chunks gevonden in ${ASSETS}/`)
  process.exit(1)
}

// Alles waarin een verwijzing kan staan: de chunks zelf plus de HTML die ze inlaadt.
const carriers = [...chunks.map((c) => join(ASSETS, c.file)), 'index.html']
const read = new Map(carriers.map((p) => [p, readFileSync(p, 'utf8')]))

// `Home.a1b2c3d4.js` -> `Home.js`, zodat de build-id niet afhangt van de namen
// die de vorige ronde heeft uitgedeeld.
const canonical = (text) =>
  chunks.reduce(
    (acc, c) =>
      acc.replace(new RegExp(`${escape(c.base)}\\.[0-9a-f]{8}\\.${c.ext}`, 'g'), `${c.base}.${c.ext}`),
    text,
  )

const digest = createHash('sha256')
for (const c of chunks) {
  digest.update(`${c.base}.${c.ext}\0`)
  digest.update(canonical(read.get(join(ASSETS, c.file))))
  digest.update('\0')
}
const buildId = digest.digest('hex').slice(0, 8)

const renames = chunks
  .map((c) => ({ ...c, next: `${c.base}.${buildId}.${c.ext}` }))
  .filter((c) => c.next !== c.file)

if (renames.length === 0) {
  console.log(`niets te doen — alles staat al op build ${buildId}`)
  process.exit(0)
}

// Eerst alle verwijzingen bijwerken, dan pas hernoemen: zo is er geen moment
// waarop een bestand naar een naam wijst die nog niet bestaat.
for (const [path, text] of read) {
  let next = text
  for (const r of renames) next = next.split(r.file).join(r.next)
  if (next !== text) writeFileSync(path, next)
}

for (const r of renames) {
  renameSync(join(ASSETS, r.file), join(ASSETS, r.next))
  console.log(`${r.file}  ->  ${r.next}`)
}
console.log(`build ${buildId}`)
