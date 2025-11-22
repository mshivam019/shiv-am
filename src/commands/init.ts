import prompts from 'prompts';
import ora from 'ora';
import chalk from 'chalk';
import { ProjectConfig, Framework, Database, Auth, Queue, Preset } from '../types/index.js';
import { generateProject } from '../generators/project.js';

export async function initProject(name?: string, options?: any) {
  console.log(chalk.blue.bold('\n🚀 Welcome to create-shiv-am!\n'));

  let config: ProjectConfig;

  // If all options provided via CLI flags, skip interactive mode
  if (name && options?.framework && options?.db && options?.auth) {
    config = {
      name,
      framework: options.framework as Framework,
      typescript: options.ts !== false,
      database: options.db as Database,
      auth: options.auth as Auth,
      queue: options.queue as Queue || 'none',
      preset: options.preset as Preset || 'api',
      features: {
        cron: options.preset === 'full',
        logging: true,
        testing: true
      }
    };
  } else {
    // Interactive mode
    const response = await prompts([
      {
        type: name ? null : 'text',
        name: 'name',
        message: 'Project name:',
        initial: 'my-backend'
      },
      {
        type: 'select',
        name: 'framework',
        message: 'Choose your framework:',
        choices: [
          { title: 'Express', value: 'express' },
          { title: 'Hono', value: 'hono' }
        ],
        initial: 0
      },
      {
        type: 'confirm',
        name: 'typescript',
        message: 'Use TypeScript?',
        initial: true
      },
      {
        type: 'select',
        name: 'preset',
        message: 'Choose a preset:',
        choices: [
          { title: 'Minimal (routes + controllers only)', value: 'minimal' },
          { title: 'API (+ database + auth)', value: 'api' },
          { title: 'Full (+ queue + cron + admin)', value: 'full' }
        ],
        initial: 1
      },
      {
        type: (prev) => prev !== 'minimal' ? 'select' : null,
        name: 'database',
        message: 'Database:',
        choices: [
          { title: 'PostgreSQL', value: 'pg' },
          { title: 'MySQL', value: 'mysql' },
          { title: 'None', value: 'none' }
        ],
        initial: 0
      },
      {
        type: (prev, values) => values.preset !== 'minimal' ? 'select' : null,
        name: 'auth',
        message: 'Authentication:',
        choices: [
          { title: 'JWT', value: 'jwt' },
          { title: 'JWKS (JWT with key rotation)', value: 'jwks' },
          { title: 'None', value: 'none' }
        ],
        initial: 0
      },
      {
        type: (prev, values) => values.preset === 'full' ? 'select' : null,
        name: 'queue',
        message: 'Job queue:',
        choices: [
          { title: 'BullMQ (Redis-based)', value: 'bull' },
          { title: 'None', value: 'none' }
        ],
        initial: 0
      }
    ]);

    if (!response.name && !name) {
      console.log(chalk.red('\n❌ Setup cancelled'));
      process.exit(1);
    }

    config = {
      name: name || response.name,
      framework: response.framework || 'express',
      typescript: response.typescript !== false,
      database: response.database || 'none',
      auth: response.auth || 'none',
      queue: response.queue || 'none',
      preset: response.preset || 'minimal',
      features: {
        cron: response.preset === 'full',
        logging: true,
        testing: true
      }
    };
  }

  const spinner = ora('Generating project...').start();

  try {
    await generateProject(config);
    spinner.succeed(chalk.green('Project generated successfully!'));
    
    console.log(chalk.blue('\n📦 Next steps:'));
    console.log(chalk.gray(`  cd ${config.name}`));
    console.log(chalk.gray('  npm install'));
    console.log(chalk.gray('  cp .env.example .env'));
    console.log(chalk.gray('  npm run dev\n'));
  } catch (error) {
    spinner.fail(chalk.red('Failed to generate project'));
    console.error(error);
    process.exit(1);
  }
}
