import * as fs from 'fs-extra';
import * as path from 'path';

export async function generateLockAdapter(
  projectPath: string,
  ext: string,
  backend: 'redis' | 'postgres' | 'mysql' | 'file'
) {
  let adapterContent = '';

  switch (backend) {
    case 'redis':
      adapterContent = generateRedisAdapter();
      break;
    case 'postgres':
      adapterContent = generatePostgresAdapter();
      break;
    case 'mysql':
      adapterContent = generateMySQLAdapter();
      break;
    case 'file':
      adapterContent = generateFileAdapter();
      break;
  }

  await fs.outputFile(
    path.join(projectPath, `src/cron/lock-adapter.${ext}`),
    adapterContent
  );

  // Generate SQL schema if database backend
  if (backend === 'postgres' || backend === 'mysql') {
    await generateLockSchema(projectPath, backend);
  }
}

function generateRedisAdapter(): string {
  return `import Redis from 'ioredis';

const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    return delay;
  }
});

export async function acquireLock(lockKey: string, ttl: number = 60000): Promise<boolean> {
  try {
    const result = await redis.set(
      lockKey,
      process.env.INSTANCE_ID || process.pid.toString(),
      'PX',
      ttl,
      'NX'
    );
    return result === 'OK';
  } catch (error) {
    console.error('Failed to acquire lock:', error);
    return false;
  }
}

export async function releaseLock(lockKey: string): Promise<void> {
  try {
    await redis.del(lockKey);
  } catch (error) {
    console.error('Failed to release lock:', error);
  }
}

export async function cleanup(): Promise<void> {
  await redis.quit();
}
`;
}

function generatePostgresAdapter(): string {
  return `import { pool } from '../db/index.js';

export async function acquireLock(lockKey: string, ttl: number = 60000): Promise<boolean> {
  const client = await pool.connect();
  try {
    const expiresAt = new Date(Date.now() + ttl);
    const instanceId = process.env.INSTANCE_ID || process.pid.toString();

    // Try to insert lock
    const result = await client.query(
      \`INSERT INTO cron_locks (lock_key, instance_id, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (lock_key) DO NOTHING
       RETURNING lock_key\`,
      [lockKey, instanceId, expiresAt]
    );

    if (result.rowCount > 0) {
      return true;
    }

    // Check if existing lock is expired
    const expiredResult = await client.query(
      \`DELETE FROM cron_locks
       WHERE lock_key = $1 AND expires_at < NOW()
       RETURNING lock_key\`,
      [lockKey]
    );

    if (expiredResult.rowCount > 0) {
      // Try to acquire again
      const retryResult = await client.query(
        \`INSERT INTO cron_locks (lock_key, instance_id, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (lock_key) DO NOTHING
         RETURNING lock_key\`,
        [lockKey, instanceId, expiresAt]
      );
      return retryResult.rowCount > 0;
    }

    return false;
  } catch (error) {
    console.error('Failed to acquire lock:', error);
    return false;
  } finally {
    client.release();
  }
}

export async function releaseLock(lockKey: string): Promise<void> {
  try {
    await pool.query(
      'DELETE FROM cron_locks WHERE lock_key = $1',
      [lockKey]
    );
  } catch (error) {
    console.error('Failed to release lock:', error);
  }
}

export async function cleanup(): Promise<void> {
  // Cleanup expired locks
  try {
    await pool.query('DELETE FROM cron_locks WHERE expires_at < NOW()');
  } catch (error) {
    console.error('Failed to cleanup locks:', error);
  }
}
`;
}

function generateMySQLAdapter(): string {
  return `import { pool } from '../db/index.js';

export async function acquireLock(lockKey: string, ttl: number = 60000): Promise<boolean> {
  const connection = await pool.getConnection();
  try {
    const expiresAt = new Date(Date.now() + ttl);
    const instanceId = process.env.INSTANCE_ID || process.pid.toString();

    // Try to insert lock
    const [result]: any = await connection.query(
      \`INSERT IGNORE INTO cron_locks (lock_key, instance_id, expires_at)
       VALUES (?, ?, ?)\`,
      [lockKey, instanceId, expiresAt]
    );

    if (result.affectedRows > 0) {
      return true;
    }

    // Check if existing lock is expired
    const [expiredResult]: any = await connection.query(
      \`DELETE FROM cron_locks
       WHERE lock_key = ? AND expires_at < NOW()\`,
      [lockKey]
    );

    if (expiredResult.affectedRows > 0) {
      // Try to acquire again
      const [retryResult]: any = await connection.query(
        \`INSERT IGNORE INTO cron_locks (lock_key, instance_id, expires_at)
         VALUES (?, ?, ?)\`,
        [lockKey, instanceId, expiresAt]
      );
      return retryResult.affectedRows > 0;
    }

    return false;
  } catch (error) {
    console.error('Failed to acquire lock:', error);
    return false;
  } finally {
    connection.release();
  }
}

export async function releaseLock(lockKey: string): Promise<void> {
  try {
    await pool.query(
      'DELETE FROM cron_locks WHERE lock_key = ?',
      [lockKey]
    );
  } catch (error) {
    console.error('Failed to release lock:', error);
  }
}

export async function cleanup(): Promise<void> {
  // Cleanup expired locks
  try {
    await pool.query('DELETE FROM cron_locks WHERE expires_at < NOW()');
  } catch (error) {
    console.error('Failed to cleanup locks:', error);
  }
}
`;
}

function generateFileAdapter(): string {
  return `import * as fs from 'fs-extra';
import * as path from 'path';
import * as os from 'os';

const LOCK_DIR = path.join(os.tmpdir(), 'cron-locks');

// Ensure lock directory exists
fs.ensureDirSync(LOCK_DIR);

interface LockFile {
  instanceId: string;
  expiresAt: number;
}

export async function acquireLock(lockKey: string, ttl: number = 60000): Promise<boolean> {
  const lockPath = path.join(LOCK_DIR, \`\${lockKey}.lock\`);
  const instanceId = process.env.INSTANCE_ID || process.pid.toString();
  const expiresAt = Date.now() + ttl;

  try {
    // Check if lock file exists
    if (await fs.pathExists(lockPath)) {
      const lockData: LockFile = await fs.readJSON(lockPath);
      
      // Check if lock is expired
      if (lockData.expiresAt < Date.now()) {
        // Lock expired, remove it
        await fs.remove(lockPath);
      } else {
        // Lock still valid
        return false;
      }
    }

    // Try to create lock file
    await fs.writeJSON(lockPath, {
      instanceId,
      expiresAt
    }, { flag: 'wx' }); // wx = create new file, fail if exists

    return true;
  } catch (error: any) {
    if (error.code === 'EEXIST') {
      // Another process created the lock
      return false;
    }
    console.error('Failed to acquire lock:', error);
    return false;
  }
}

export async function releaseLock(lockKey: string): Promise<void> {
  const lockPath = path.join(LOCK_DIR, \`\${lockKey}.lock\`);
  try {
    await fs.remove(lockPath);
  } catch (error) {
    console.error('Failed to release lock:', error);
  }
}

export async function cleanup(): Promise<void> {
  // Cleanup expired locks
  try {
    const files = await fs.readdir(LOCK_DIR);
    const now = Date.now();

    for (const file of files) {
      if (!file.endsWith('.lock')) continue;

      const lockPath = path.join(LOCK_DIR, file);
      try {
        const lockData: LockFile = await fs.readJSON(lockPath);
        if (lockData.expiresAt < now) {
          await fs.remove(lockPath);
        }
      } catch (error) {
        // Invalid lock file, remove it
        await fs.remove(lockPath);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup locks:', error);
  }
}
`;
}

async function generateLockSchema(projectPath: string, backend: 'postgres' | 'mysql') {
  let schemaContent = '';

  if (backend === 'postgres') {
    schemaContent = `-- PostgreSQL schema for cron locks
-- Run this migration to enable distributed cron locking

CREATE TABLE IF NOT EXISTS cron_locks (
  lock_key VARCHAR(255) PRIMARY KEY,
  instance_id VARCHAR(255) NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON cron_locks(expires_at);

-- Optional: Add a cleanup function
CREATE OR REPLACE FUNCTION cleanup_expired_cron_locks()
RETURNS void AS $$
BEGIN
  DELETE FROM cron_locks WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Optional: Schedule automatic cleanup (requires pg_cron extension)
-- SELECT cron.schedule('cleanup-cron-locks', '*/5 * * * *', 'SELECT cleanup_expired_cron_locks()');
`;
  } else {
    schemaContent = `-- MySQL schema for cron locks
-- Run this migration to enable distributed cron locking

CREATE TABLE IF NOT EXISTS cron_locks (
  lock_key VARCHAR(255) PRIMARY KEY,
  instance_id VARCHAR(255) NOT NULL,
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Index for cleanup queries
CREATE INDEX idx_cron_locks_expires_at ON cron_locks(expires_at);

-- Optional: Add a cleanup procedure
DELIMITER //
CREATE PROCEDURE cleanup_expired_cron_locks()
BEGIN
  DELETE FROM cron_locks WHERE expires_at < NOW();
END //
DELIMITER ;

-- Optional: Schedule automatic cleanup (requires MySQL Event Scheduler)
-- SET GLOBAL event_scheduler = ON;
-- CREATE EVENT IF NOT EXISTS cleanup_cron_locks_event
-- ON SCHEDULE EVERY 5 MINUTE
-- DO CALL cleanup_expired_cron_locks();
`;
  }

  await fs.outputFile(
    path.join(projectPath, `migrations/cron_locks.sql`),
    schemaContent
  );
}
