import { existsSync } from 'node:fs'
import process from 'node:process'
import { config } from 'dotenv'

/** Read .env.local then .env, without overwriting anything already in the environment. */
export function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    if (existsSync(file)) config({ path: file, override: false, quiet: true })
  }
  return process.env
}
