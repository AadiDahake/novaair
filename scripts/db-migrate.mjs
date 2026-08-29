#!/usr/bin/env node
/**
 * Apply every SQL file in supabase/migrations, in name order.
 * Plain `pg`, so it needs no Supabase CLI, no Docker and no local Postgres.
 *
 * Needs SUPABASE_DB_URL, the direct Postgres connection string for the project.
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import process from 'node:process'
import pg from 'pg'
import { loadEnv } from './lib/env.mjs'

loadEnv()

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString) {
  console.error('SUPABASE_DB_URL is not set. See .env.example.')
  process.exit(1)
}

const directory = join(process.cwd(), 'supabase', 'migrations')
const files = (await readdir(directory)).filter((name) => name.endsWith('.sql')).sort()

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } })
await client.connect()

try {
  await client.query(`
    create table if not exists schema_migration (
      name       text primary key,
      applied_at timestamptz not null default now()
    )
  `)

  for (const file of files) {
    const { rowCount } = await client.query('select 1 from schema_migration where name = $1', [file])
    if (rowCount && rowCount > 0) {
      console.log(`skip  ${file}`)
      continue
    }
    const sql = await readFile(join(directory, file), 'utf8')
    await client.query('begin')
    try {
      await client.query(sql)
      await client.query('insert into schema_migration (name) values ($1)', [file])
      await client.query('commit')
      console.log(`apply ${file}`)
    } catch (error) {
      await client.query('rollback')
      throw error
    }
  }
  console.log('migrations up to date')
} finally {
  await client.end()
}
