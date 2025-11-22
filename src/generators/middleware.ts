import prompts from 'prompts';
import * as fs from 'fs-extra';
import * as path from 'path';
import chalk from 'chalk';

export async function addMiddleware(name: string) {
  const response = await prompts([
    {
      type: 'select',
      name: 'type',
      message: 'Middleware type:',
      choices: [
        { title: 'Request Logger', value: 'logger' },
        { title: 'Rate Limiter', value: 'rateLimit' },
        { title: 'CORS', value: 'cors' },
        { title: 'Custom', value: 'custom' }
      ]
    },
    {
      type: 'confirm',
      name: 'isDefault',
      message: 'Apply as default middleware?',
      initial: false
    }
  ]);

  const projectRoot = process.cwd();
  await createMiddleware(projectRoot, name, response);
}

async function createMiddleware(projectRoot: string, name: string, config: any) {
  const middlewarePath = path.join(projectRoot, 'src/middleware', `${name}.ts`);
  
  // Detect framework
  const packageJson = JSON.parse(
    await fs.readFile(path.join(projectRoot, 'package.json'), 'utf-8')
  );
  const isHono = packageJson.dependencies?.hono;

  let middlewareContent = '';

  if (isHono) {
    middlewareContent = generateHonoMiddleware(name, config.type);
  } else {
    middlewareContent = generateExpressMiddleware(name, config.type);
  }

  await fs.outputFile(middlewarePath, middlewareContent);
  console.log(chalk.green(`✓ Created middleware: ${middlewarePath}`));

  if (config.isDefault) {
    await addToDefaultMiddleware(projectRoot, name, isHono);
  }
}

function generateExpressMiddleware(name: string, type: string): string {
  const templates: Record<string, string> = {
    logger: `import { Request, Response, NextFunction } from 'express';

export function ${name}Middleware(req: Request, res: Response, next: NextFunction) {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    console.log(\`[\${req.method}] \${req.path} - \${res.statusCode} (\${duration}ms)\`);
  });
  
  next();
}`,
    rateLimit: `import { Request, Response, NextFunction } from 'express';

const requests = new Map<string, number[]>();

export function ${name}Middleware(req: Request, res: Response, next: NextFunction) {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const windowMs = 60000; // 1 minute
  const maxRequests = 100;

  if (!requests.has(ip)) {
    requests.set(ip, []);
  }

  const userRequests = requests.get(ip)!.filter(time => now - time < windowMs);
  
  if (userRequests.length >= maxRequests) {
    return res.status(429).json({ error: 'Too many requests' });
  }

  userRequests.push(now);
  requests.set(ip, userRequests);
  next();
}`,
    cors: `import { Request, Response, NextFunction } from 'express';

export function ${name}Middleware(req: Request, res: Response, next: NextFunction) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (req.method === 'OPTIONS') {
    return res.sendStatus(200);
  }
  
  next();
}`,
    custom: `import { Request, Response, NextFunction } from 'express';

export function ${name}Middleware(req: Request, res: Response, next: NextFunction) {
  // TODO: Implement custom middleware logic
  console.log('${name} middleware executed');
  next();
}`
  };

  return templates[type] || templates.custom;
}

function generateHonoMiddleware(name: string, type: string): string {
  const templates: Record<string, string> = {
    logger: `import { Context, Next } from 'hono';

export async function ${name}Middleware(c: Context, next: Next) {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  console.log(\`[\${c.req.method}] \${c.req.path} - \${c.res.status} (\${duration}ms)\`);
}`,
    rateLimit: `import { Context, Next } from 'hono';

const requests = new Map<string, number[]>();

export async function ${name}Middleware(c: Context, next: Next) {
  const ip = c.req.header('x-forwarded-for') || 'unknown';
  const now = Date.now();
  const windowMs = 60000;
  const maxRequests = 100;

  if (!requests.has(ip)) {
    requests.set(ip, []);
  }

  const userRequests = requests.get(ip)!.filter(time => now - time < windowMs);
  
  if (userRequests.length >= maxRequests) {
    return c.json({ error: 'Too many requests' }, 429);
  }

  userRequests.push(now);
  requests.set(ip, userRequests);
  await next();
}`,
    cors: `import { Context, Next } from 'hono';

export async function ${name}Middleware(c: Context, next: Next) {
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  
  if (c.req.method === 'OPTIONS') {
    return c.text('', 200);
  }
  
  await next();
}`,
    custom: `import { Context, Next } from 'hono';

export async function ${name}Middleware(c: Context, next: Next) {
  // TODO: Implement custom middleware logic
  console.log('${name} middleware executed');
  await next();
}`
  };

  return templates[type] || templates.custom;
}

async function addToDefaultMiddleware(projectRoot: string, name: string, isHono: boolean) {
  const appPath = path.join(projectRoot, 'src/app.ts');
  
  try {
    let content = await fs.readFile(appPath, 'utf-8');
    
    // Add import
    const importLine = `import { ${name}Middleware } from './middleware/${name}';`;
    if (!content.includes(importLine)) {
      const lastImport = content.lastIndexOf('import');
      const endOfLastImport = content.indexOf('\n', lastImport);
      content = content.slice(0, endOfLastImport + 1) + importLine + '\n' + content.slice(endOfLastImport + 1);
    }

    // Add middleware usage
    const useLine = isHono 
      ? `  app.use(${name}Middleware);`
      : `  app.use(${name}Middleware);`;
    
    if (!content.includes(useLine)) {
      const healthCheck = content.indexOf('app.get(\'/health\'');
      if (healthCheck !== -1) {
        content = content.slice(0, healthCheck) + useLine + '\n\n' + content.slice(healthCheck);
      }
    }

    await fs.outputFile(appPath, content);
    console.log(chalk.green(`✓ Added ${name} as default middleware`));
  } catch (error) {
    console.error(chalk.red('Failed to add default middleware:'), error);
  }
}
