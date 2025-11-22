import * as fs from 'fs-extra';
import * as path from 'path';
import { ProjectConfig } from '../types/index.js';
import { generateExpressProject } from './frameworks/express.js';
import { generateHonoProject } from './frameworks/hono.js';
import { getTemplateContext } from '../utils/template.js';

export async function generateProject(config: ProjectConfig) {
  const projectPath = path.join(process.cwd(), config.name);
  
  await fs.ensureDir(projectPath);

  // Create directory structure based on preset
  const structure = ['src/routes', 'src/controllers', 'src/services', 'src/config', 'src/helpers'];

  if (config.preset !== 'minimal') {
    structure.push('src/middlewares');
    
    if (config.auth !== 'none') {
      structure.push('src/auth');
    }
    
    if (config.database !== 'none') {
      structure.push('src/db');
    }
  }

  if (config.preset === 'full' || config.features.cron) {
    structure.push('src/cron');
  }
  
  if (config.preset === 'full' && config.queue !== 'none') {
    structure.push('src/queue');
  }

  if (config.typescript) {
    structure.push('src/types');
  }

  for (const dir of structure) {
    await fs.ensureDir(path.join(projectPath, dir));
  }

  // Generate framework-specific files
  const templateContext = getTemplateContext(config);
  
  if (config.framework === 'express') {
    await generateExpressProject(projectPath, config, templateContext);
  } else if (config.framework === 'hono') {
    await generateHonoProject(projectPath, config, templateContext);
  }
  
  // Generate common files
  await generateConfigFiles(projectPath, config, templateContext);
  await generatePackageJson(projectPath, config);
  await generateEnvFile(projectPath, config);
  await generateTsConfig(projectPath, config);
  await generateGitIgnore(projectPath);
  await generateDockerFiles(projectPath, config);
  await generateScripts(projectPath, config);
  
  // Generate PM2 configuration
  const { generatePM2Config } = await import('./pm2.js');
  await generatePM2Config(projectPath, config);
  
  // Generate lock adapter for cron jobs
  if (config.features.cron) {
    const { generateLockAdapter } = await import('./cron-locks.js');
    const ext = config.typescript ? 'ts' : 'js';
    let lockBackend: 'redis' | 'postgres' | 'mysql' | 'file' = 'file';
    if (config.database === 'pg') {
      lockBackend = 'postgres';
    } else if (config.database === 'mysql') {
      lockBackend = 'mysql';
    }
    await generateLockAdapter(projectPath, ext, lockBackend);
  }

}

async function generateConfigFiles(projectPath: string, config: ProjectConfig, ctx: any) {
  const ext = ctx.fileExt;
  
  // Main config with zod validation
  const configContent = `import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const configSchema = z.object({
  port: z.number().default(3000),
  env: z.enum(['development', 'production', 'test']).default('development'),
  ${ctx.hasAuth ? `jwt: z.object({
    secret: z.string().min(32),
    expiresIn: z.string().default('24h'),
    ${ctx.hasJWKS ? `jwksUri: z.string().url(),
    audience: z.string(),
    issuer: z.string(),` : ''}
  }),` : ''}
  ${ctx.hasDatabase ? `database: z.object({
    host: z.string(),
    port: z.number(),
    name: z.string(),
    user: z.string(),
    password: z.string(),
    pool: z.object({
      min: z.number().default(2),
      max: z.number().default(10),
    }),
  }),` : ''}
  ${ctx.hasLogging ? `logging: z.object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  }),` : ''}
});

export type Config = z.infer<typeof configSchema>;

export const config: Config = configSchema.parse({
  port: Number(process.env.PORT) || 3000,
  env: process.env.NODE_ENV || 'development',
  ${ctx.hasAuth ? `jwt: {
    secret: process.env.JWT_SECRET!,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
    ${ctx.hasJWKS ? `jwksUri: process.env.JWKS_URI!,
    audience: process.env.JWT_AUDIENCE!,
    issuer: process.env.JWT_ISSUER!,` : ''}
  },` : ''}
  ${ctx.hasDatabase ? `database: {
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || ${config.database === 'pg' ? 5432 : 3306},
    name: process.env.DB_NAME || '${config.name}',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    pool: {
      min: Number(process.env.DB_POOL_MIN) || 2,
      max: Number(process.env.DB_POOL_MAX) || 10,
    },
  },` : ''}
  ${ctx.hasLogging ? `logging: {
    level: (process.env.LOG_LEVEL as any) || 'info',
  },` : ''}
});
`;

  await fs.outputFile(path.join(projectPath, `src/config/index.${ext}`), configContent);
}

async function generatePackageJson(projectPath: string, config: ProjectConfig) {
  const dependencies: Record<string, string> = {
    'dotenv': '^16.3.1',
  };
  
  const devDependencies: Record<string, string> = {
    'nodemon': '^3.0.2',
    'eslint': '^8.55.0',
    'prettier': '^3.1.1',
  };

  if (config.typescript) {
    dependencies['zod'] = '^3.22.4';
    devDependencies['@types/node'] = '^20.10.0';
    devDependencies['typescript'] = '^5.3.3';
    devDependencies['tsx'] = '^4.7.0';
    devDependencies['ts-node-dev'] = '^2.0.0';
  }

  if (config.framework === 'express') {
    dependencies['express'] = '^4.18.2';
    dependencies['express-async-errors'] = '^3.1.1';
    if (config.typescript) {
      devDependencies['@types/express'] = '^4.17.21';
    }
  } else if (config.framework === 'hono') {
    dependencies['hono'] = '^3.11.7';
    dependencies['@hono/node-server'] = '^1.4.1';
  }

  if (config.auth === 'jwt') {
    dependencies['jsonwebtoken'] = '^9.0.2';
    if (config.typescript) {
      devDependencies['@types/jsonwebtoken'] = '^9.0.5';
    }
  }

  if (config.auth === 'jwks') {
    dependencies['jsonwebtoken'] = '^9.0.2';
    dependencies['jwks-rsa'] = '^3.1.0';
    if (config.typescript) {
      devDependencies['@types/jsonwebtoken'] = '^9.0.5';
    }
  }

  if (config.features.cron) {
    dependencies['node-cron'] = '^3.0.3';
    if (config.typescript) {
      devDependencies['@types/node-cron'] = '^3.0.11';
    }
    // Note: ioredis only added if user explicitly wants Redis backend
  }

  // PM2 for production
  devDependencies['pm2'] = '^5.3.0';

  if (config.queue === 'bull') {
    dependencies['bullmq'] = '^5.1.0';
    dependencies['ioredis'] = '^5.3.2';
  }

  if (config.database === 'pg') {
    dependencies['pg'] = '^8.11.3';
    if (config.typescript) {
      devDependencies['@types/pg'] = '^8.10.9';
    }
  } else if (config.database === 'mysql') {
    dependencies['mysql2'] = '^3.6.5';
  }

  if (config.features.logging) {
    dependencies['pino'] = '^8.17.2';
    dependencies['pino-pretty'] = '^10.3.1';
  }

  if (config.features.testing) {
    devDependencies['vitest'] = '^1.0.4';
  }

  const ext = config.typescript ? 'ts' : 'js';
  const scripts: Record<string, string> = {
    dev: config.typescript 
      ? `ts-node-dev --respawn --transpile-only src/server.${ext}`
      : `nodemon src/server.${ext}`,
    build: config.typescript ? 'tsc' : 'echo "No build needed for JS"',
    start: config.typescript ? 'node dist/server.js' : `node src/server.${ext}`,
    'start:pm2': 'pm2 start ecosystem.config.js --env production',
    'stop:pm2': 'pm2 stop ecosystem.config.js',
    'restart:pm2': 'pm2 restart ecosystem.config.js',
    'logs:pm2': 'pm2 logs',
    'monit:pm2': 'pm2 monit',
    lint: 'eslint . --ext .ts,.js',
    format: 'prettier --write "src/**/*.{ts,js}"',
  };

  if (config.features.testing) {
    scripts.test = 'vitest run';
    scripts['test:watch'] = 'vitest';
  }

  const packageJson = {
    name: config.name,
    version: '1.0.0',
    description: `Backend project generated with create-shiv-am`,
    main: config.typescript ? 'dist/server.js' : 'src/server.js',
    type: 'module',
    scripts,
    dependencies,
    devDependencies
  };

  await fs.outputFile(
    path.join(projectPath, 'package.json'),
    JSON.stringify(packageJson, null, 2)
  );
}

async function generateEnvFile(projectPath: string, config: ProjectConfig) {
  let envContent = `# Server
PORT=3000
NODE_ENV=development
`;

  if (config.auth === 'jwt') {
    envContent += `\n# JWT Authentication
JWT_SECRET=your-super-secret-key-change-this-in-production-min-32-chars
JWT_EXPIRES_IN=24h
`;
  }

  if (config.auth === 'jwks') {
    envContent += `\n# JWKS Authentication
JWT_SECRET=your-super-secret-key-change-this-in-production-min-32-chars
JWKS_URI=https://your-auth-provider.com/.well-known/jwks.json
JWT_AUDIENCE=your-api-audience
JWT_ISSUER=https://your-auth-provider.com/
`;
  }

  if (config.database !== 'none') {
    const defaultPort = config.database === 'pg' ? 5432 : 3306;
    envContent += `\n# Database
DB_HOST=localhost
DB_PORT=${defaultPort}
DB_NAME=${config.name}
DB_USER=root
DB_PASSWORD=
DB_POOL_MIN=2
DB_POOL_MAX=10
`;
  }

  if (config.queue === 'bull') {
    envContent += `\n# Redis (for BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
`;
  }

  if (config.features.logging) {
    envContent += `\n# Logging
LOG_LEVEL=info
`;
  }

  await fs.outputFile(path.join(projectPath, '.env.example'), envContent);
}

async function generateTsConfig(projectPath: string, config: ProjectConfig) {
  if (!config.typescript) return;

  const tsConfig = {
    compilerOptions: {
      target: 'ES2022',
      module: 'ESNext',
      lib: ['ES2022'],
      moduleResolution: 'node',
      outDir: './dist',
      rootDir: './src',
      strict: true,
      esModuleInterop: true,
      skipLibCheck: true,
      forceConsistentCasingInFileNames: true,
      resolveJsonModule: true,
      declaration: true,
      declarationMap: true,
      sourceMap: true,
      noUnusedLocals: true,
      noUnusedParameters: true,
      noImplicitReturns: true,
      noFallthroughCasesInSwitch: true
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist']
  };

  await fs.outputFile(
    path.join(projectPath, 'tsconfig.json'),
    JSON.stringify(tsConfig, null, 2)
  );
}

async function generateGitIgnore(projectPath: string) {
  const gitignore = `node_modules/
dist/
*.log
.env
.DS_Store
coverage/
.vscode/
.idea/
`;

  await fs.outputFile(path.join(projectPath, '.gitignore'), gitignore);
}

async function generateDockerFiles(projectPath: string, config: ProjectConfig) {
  const dockerfile = `FROM node:20-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY ${config.typescript ? 'dist' : 'src'} ./${config.typescript ? 'dist' : 'src'}

EXPOSE 3000

CMD ["npm", "start"]
`;

  await fs.outputFile(path.join(projectPath, 'Dockerfile'), dockerfile);

  if (config.queue === 'bull' || config.database !== 'none') {
    const composeServices: any = {};

    if (config.database === 'pg') {
      composeServices.postgres = {
        image: 'postgres:16-alpine',
        environment: {
          POSTGRES_DB: config.name,
          POSTGRES_USER: 'root',
          POSTGRES_PASSWORD: 'password'
        },
        ports: ['5432:5432'],
        volumes: ['postgres_data:/var/lib/postgresql/data']
      };
    }

    if (config.queue === 'bull') {
      composeServices.redis = {
        image: 'redis:7-alpine',
        ports: ['6379:6379'],
        volumes: ['redis_data:/data']
      };
    }

    const compose = {
      version: '3.8',
      services: composeServices,
      volumes: Object.keys(composeServices).reduce((acc: any, key) => {
        acc[`${key}_data`] = {};
        return acc;
      }, {})
    };

    await fs.outputFile(
      path.join(projectPath, 'docker-compose.yml'),
      JSON.stringify(compose, null, 2)
    );
  }
}

async function generateScripts(projectPath: string, config: ProjectConfig) {
  // Add README
  const readme = `# ${config.name}

Backend project generated with create-shiv-am

## Features

- Framework: ${config.framework}
- Language: ${config.typescript ? 'TypeScript' : 'JavaScript'}
- Database: ${config.database}
- Auth: ${config.auth}
${config.queue !== 'none' ? `- Queue: ${config.queue}` : ''}
${config.features.cron ? '- Cron jobs' : ''}

## Getting Started

\`\`\`bash
# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Start development server
npm run dev
\`\`\`

## Scripts

- \`npm run dev\` - Start development server
- \`npm run build\` - Build for production
- \`npm start\` - Start production server
- \`npm run lint\` - Lint code
- \`npm run format\` - Format code
${config.features.testing ? '- `npm test` - Run tests' : ''}

## Project Structure

\`\`\`
src/
├── server.${config.typescript ? 'ts' : 'js'}      # Server entry point
├── app.${config.typescript ? 'ts' : 'js'}         # App composition
├── routes/          # Route definitions
├── controllers/     # Request handlers
├── services/        # Business logic
${config.preset !== 'minimal' ? `├── middlewares/    # Custom middleware
${config.auth !== 'none' ? '├── auth/           # Authentication' : ''}
${config.database !== 'none' ? '├── db/             # Database connection' : ''}` : ''}
${config.features.cron ? '├── cron/          # Scheduled jobs' : ''}
├── config/          # Configuration
└── helpers/         # Utility functions
\`\`\`
`;

  await fs.outputFile(path.join(projectPath, 'README.md'), readme);
}
