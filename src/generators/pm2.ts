import * as fs from 'fs-extra';
import * as path from 'path';
import { ProjectConfig } from '../types/index.js';

export async function generatePM2Config(projectPath: string, config: ProjectConfig) {
  const pm2Config = {
    apps: [
      {
        name: config.name,
        script: config.typescript ? 'dist/server.js' : 'src/server.js',
        instances: 'max',
        exec_mode: 'cluster',
        env: {
          NODE_ENV: 'development'
        },
        env_production: {
          NODE_ENV: 'production'
        },
        error_file: './logs/pm2-error.log',
        out_file: './logs/pm2-out.log',
        log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
        merge_logs: true,
        autorestart: true,
        watch: false,
        max_memory_restart: '1G',
        instance_var: 'INSTANCE_ID'
      }
    ]
  };

  await fs.outputFile(
    path.join(projectPath, 'ecosystem.config.json'),
    JSON.stringify(pm2Config, null, 2)
  );

  // Also create JS version for more flexibility
  const pm2ConfigJS = `module.exports = {
  apps: [
    {
      name: '${config.name}',
      script: '${config.typescript ? 'dist/server.js' : 'src/server.js'}',
      instances: 'max',
      exec_mode: 'cluster',
      env: {
        NODE_ENV: 'development'
      },
      env_production: {
        NODE_ENV: 'production'
      },
      error_file: './logs/pm2-error.log',
      out_file: './logs/pm2-out.log',
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      instance_var: 'INSTANCE_ID'
    }
  ]
};
`;

  await fs.outputFile(
    path.join(projectPath, 'ecosystem.config.js'),
    pm2ConfigJS
  );
}

export async function generateThreadSafeCron(projectPath: string, ext: string, lockBackend: 'redis' | 'postgres' | 'mysql' | 'file' = 'file') {
  // Generate the appropriate lock adapter
  const { generateLockAdapter } = await import('./cron-locks.js');
  await generateLockAdapter(projectPath, ext, lockBackend);
  
  const cronContent = `import cron from 'node-cron';
import { acquireLock, releaseLock } from './lock-adapter.js';



/**
 * Thread-safe cron job wrapper
 */
function createThreadSafeCron(
  schedule: string,
  lockKey: string,
  task: () => Promise<void>,
  options?: { ttl?: number }
) {
  return cron.schedule(schedule, async () => {
    const ttl = options?.ttl || 60000; // Default 1 minute
    const acquired = await acquireLock(lockKey, ttl);
    
    if (!acquired) {
      console.log(\`[\${lockKey}] Lock not acquired, skipping (another instance is running)\`);
      return;
    }

    console.log(\`[\${lockKey}] Lock acquired, executing task\`);
    
    try {
      await task();
      console.log(\`[\${lockKey}] Task completed successfully\`);
    } catch (error) {
      console.error(\`[\${lockKey}] Task failed:\`, error);
    } finally {
      await releaseLock(lockKey);
    }
  });
}

export function initCronJobs() {
  // Example: Daily cleanup at midnight (runs only on one instance)
  createThreadSafeCron(
    '0 0 * * *',
    'cron:daily-cleanup',
    async () => {
      console.log('Running daily cleanup');
      // Your cleanup logic here
    },
    { ttl: 300000 } // 5 minutes max execution time
  );

  // Example: Hourly report generation
  createThreadSafeCron(
    '0 * * * *',
    'cron:hourly-report',
    async () => {
      console.log('Generating hourly report');
      // Your report logic here
    }
  );

  // Example: Every 5 minutes health check
  createThreadSafeCron(
    '*/5 * * * *',
    'cron:health-check',
    async () => {
      console.log('Running health check');
      // Your health check logic here
    },
    { ttl: 60000 } // 1 minute max
  );

  console.log('✅ Thread-safe cron jobs initialized');
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down cron jobs...');
  process.exit(0);
});
`;

  await fs.outputFile(
    path.join(projectPath, `src/cron/index.${ext}`),
    cronContent
  );

  // Also create a simple version without Redis for single-instance deployments
  const simpleCronContent = `import cron from 'node-cron';

/**
 * Simple cron jobs (for single-instance deployments)
 * For multi-instance deployments, use the Redis-based version
 */
export function initCronJobs() {
  // Example: Daily cleanup at midnight
  cron.schedule('0 0 * * *', () => {
    console.log('Running daily cleanup');
    // Your cleanup logic here
  });

  // Example: Hourly report generation
  cron.schedule('0 * * * *', () => {
    console.log('Generating hourly report');
    // Your report logic here
  });

  // Example: Every 5 minutes health check
  cron.schedule('*/5 * * * *', () => {
    console.log('Running health check');
    // Your health check logic here
  });

  console.log('✅ Cron jobs initialized');
}
`;

  await fs.outputFile(
    path.join(projectPath, `src/cron/simple.${ext}`),
    simpleCronContent
  );
}
