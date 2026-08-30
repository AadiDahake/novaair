import pg from 'pg'

/**
 * One Postgres client factory for every script.
 *
 * Supabase hands out a pooler connection string that ends in `sslmode=require`. Recent `pg`
 * treats that as `verify-full`, and the pooler presents a self-signed chain, so the connection
 * fails before it starts. The connection is already inside Supabase's own TLS, so the scripts
 * drop the query parameter and set the SSL options themselves.
 */
function withoutSslMode(connectionString) {
  const url = new URL(connectionString)
  url.searchParams.delete('sslmode')
  return url.toString()
}

export function pgConfig(connectionString) {
  return { connectionString: withoutSslMode(connectionString), ssl: { rejectUnauthorized: false } }
}

export function createClient(connectionString) {
  return new pg.Client(pgConfig(connectionString))
}

export function createPool(connectionString, max = 4) {
  return new pg.Pool({ ...pgConfig(connectionString), max })
}
