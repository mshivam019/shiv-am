import * as fs from 'fs-extra';
import * as path from 'path';
import { ProjectConfig, TemplateContext } from '../../types/index.js';

export async function generateHonoProject(
  projectPath: string,
  config: ProjectConfig,
  ctx: TemplateContext
) {
  await generateAppFile(projectPath, config, ctx);
  await generateServerFile(projectPath, config, ctx);
  await generateMiddleware(projectPath, config, ctx);
  
  if (config.database !== 'none') {
    await generateDatabaseConnection(projectPath, config, ctx);
  }
  
  if (config.features.cron) {
    await generateCronSetup(projectPath, ctx, config);
  }

  await generateExampleRoute(projectPath, ctx);
}

async function generateAppFile(projectPath: string, config: ProjectConfig, ctx: TemplateContext) {
  const ext = ctx.fileExt;
  const appContent = `import { Hono } from 'hono';
import { routes } from './routes/index.js';
${ctx.hasAuth ? "import { authMiddleware } from './middlewares/auth.js';" : ''}
${ctx.hasCron ? "import { initCronJobs } from './cron/index.js';" : ''}

export function createApp() {
  const app = new Hono();

  app.get('/health', (c) => {
    return c.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.route('/api', routes);

  ${ctx.hasCron ? 'initCronJobs();' : ''}

  return app;
}
`;

  await fs.outputFile(path.join(projectPath, `src/app.${ext}`), appContent);
}

async function generateServerFile(projectPath: string, config: ProjectConfig, ctx: TemplateContext) {
  const ext = ctx.fileExt;
  const serverContent = `import { serve } from '@hono/node-server';
import { createApp } from './app.js';
import { config } from './config/index.js';
${ctx.hasDatabase ? "import { connectDatabase } from './db/index.js';" : ''}

async function startServer() {
  ${ctx.hasDatabase ? 'await connectDatabase();' : ''}
  
  const app = createApp();
  
  serve({
    fetch: app.fetch,
    port: config.port as number
  });

  console.log(\`🚀 Server running on port \${config.port}\`);
}

startServer().catch(console.error);
`;

  await fs.outputFile(path.join(projectPath, `src/server.${ext}`), serverContent);
}

async function generateMiddleware(projectPath: string, config: ProjectConfig, ctx: TemplateContext) {
  const ext = ctx.fileExt;
  
  if (ctx.hasAuth) {
    const authMiddleware = `import { Context, Next } from 'hono';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export async function authMiddleware(c: Context, next: Next) {
  const token = c.req.header('Authorization')?.split(' ')[1];

  if (!token) {
    return c.json({ error: 'No token provided' }, 401);
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    c.set('user', decoded);
    await next();
  } catch (error) {
    return c.json({ error: 'Invalid token' }, 401);
  }
}

export function roleMiddleware(roles: string[]) {
  return async (c: Context, next: Next) => {
    const user = c.get('user');
    if (!user || !roles.includes(user.role)) {
      return c.json({ error: 'Insufficient permissions' }, 403);
    }
    await next();
  };
}
`;

    await fs.outputFile(path.join(projectPath, `src/middlewares/auth.${ext}`), authMiddleware);
  }

  // Generate API audit log middleware for Hono
  const auditLogMiddleware = `import { Context, Next } from 'hono';

interface AuditLogEntry {
  timestamp: string;
  method: string;
  path: string;
  query: any;
  body: any;
  userId?: string;
  userEmail?: string;
  userRole?: string;
  ip: string;
  userAgent: string;
  statusCode?: number;
  responseTime?: number;
}

export async function apiAuditLog(c: Context, next: Next) {
  const startTime = Date.now();
  const user = c.get('user');
  
  // Capture request details
  const logEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    method: c.req.method,
    path: c.req.path,
    query: c.req.query(),
    body: await sanitizeBody(c),
    userId: user?.id,
    userEmail: user?.email,
    userRole: user?.role,
    ip: c.req.header('x-forwarded-for') || c.req.header('x-real-ip') || 'unknown',
    userAgent: c.req.header('user-agent') || 'unknown'
  };

  await next();

  // Capture response details
  logEntry.statusCode = c.res.status;
  logEntry.responseTime = Date.now() - startTime;
  
  // Log to console (in production, send to logging service)
  logAuditEntry(logEntry);
}

async function sanitizeBody(c: Context): Promise<any> {
  try {
    const body = await c.req.json().catch(() => null);
    if (!body) return null;
    
    // Create a copy to avoid modifying original
    const sanitized = { ...body };
    
    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey', 'creditCard'];
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        sanitized[field] = '[REDACTED]';
      }
    });
    
    return sanitized;
  } catch {
    return null;
  }
}

function logAuditEntry(entry: AuditLogEntry) {
  // Format log message
  const userInfo = entry.userId 
    ? \`User: \${entry.userId}\${entry.userEmail ? \` (\${entry.userEmail})\` : ''}\${entry.userRole ? \` [\${entry.userRole}]\` : ''}\`
    : 'User: Anonymous';
  
  const message = [
    \`[\${entry.timestamp}]\`,
    \`\${entry.method} \${entry.path}\`,
    userInfo,
    \`Status: \${entry.statusCode}\`,
    \`Time: \${entry.responseTime}ms\`,
    \`IP: \${entry.ip}\`
  ].join(' | ');
  
  console.log(message);
  
  // Log full details for non-GET requests or errors
  if (entry.method !== 'GET' || (entry.statusCode && entry.statusCode >= 400)) {
    console.log('Details:', JSON.stringify({
      query: entry.query,
      body: entry.body,
      userAgent: entry.userAgent
    }, null, 2));
  }
}
`;

  await fs.outputFile(path.join(projectPath, `src/middlewares/audit.${ext}`), auditLogMiddleware);
}

async function generateDatabaseConnection(projectPath: string, config: ProjectConfig, ctx: TemplateContext) {
  if (config.database === 'none') return;

  const ext = ctx.fileExt;
  let dbContent = '';

  if (config.database === 'pg') {
    dbContent = `import { Pool } from 'pg';
import { config } from '../config/index.js';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  min: config.database.pool.min,
  max: config.database.pool.max,
});

export async function connectDatabase() {
  try {
    await pool.query('SELECT NOW()');
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}
`;
  } else if (config.database === 'mysql') {
    dbContent = `import mysql from 'mysql2/promise';
import { config } from '../config/index.js';

export const pool = mysql.createPool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password,
  connectionLimit: config.database.pool.max,
});

export async function connectDatabase() {
  try {
    await pool.query('SELECT 1');
    console.log('✅ Database connected');
  } catch (error) {
    console.error('❌ Database connection failed:', error);
    process.exit(1);
  }
}
`;
  }

  await fs.outputFile(path.join(projectPath, `src/db/index.${ext}`), dbContent);
}

async function generateCronSetup(projectPath: string, ctx: TemplateContext, config: ProjectConfig) {
  const { generateThreadSafeCron } = await import('../pm2.js');
  
  // Determine lock backend based on database
  let lockBackend: 'redis' | 'postgres' | 'mysql' | 'file' = 'file';
  if (config.database === 'pg') {
    lockBackend = 'postgres';
  } else if (config.database === 'mysql') {
    lockBackend = 'mysql';
  }
  
  await generateThreadSafeCron(projectPath, ctx.fileExt, lockBackend);
}

async function generateExampleRoute(projectPath: string, ctx: TemplateContext) {
  const ext = ctx.fileExt;
  
  // Generate declarative routes helper (same as Express)
  const declarativeRoutesContent = `// Declarative Route System

export interface RouteDefinition {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  handler: string;
  enabled?: string[];
  disabled?: string[];
  roles?: string[];
  excludeRoles?: string[];
}

export interface RouteConfig {
  defaultMiddlewares: string[];
  defaultRoles: string[];
  routes: RouteDefinition[];
}

export class DeclarativeRouter {
  private middlewareRegistry: Map<string, Function> = new Map();
  private controllerRegistry: Map<string, any> = new Map();
  private config: RouteConfig;

  constructor(config: RouteConfig) {
    this.config = config;
  }

  registerMiddleware(name: string, middleware: Function) {
    this.middlewareRegistry.set(name, middleware);
    return this;
  }

  registerController(name: string, controller: any) {
    this.controllerRegistry.set(name, controller);
    return this;
  }

  private resolveHandler(handlerPath: string): Function {
    const [controllerName, methodName] = handlerPath.split('.');
    const controller = this.controllerRegistry.get(controllerName);
    
    if (!controller) {
      throw new Error(\`Controller '\${controllerName}' not registered\`);
    }
    
    if (!controller[methodName]) {
      throw new Error(\`Method '\${methodName}' not found in controller '\${controllerName}'\`);
    }
    
    return controller[methodName];
  }

  private buildMiddlewareChain(route: RouteDefinition): Function[] {
    const chain: Function[] = [];
    
    let middlewares = [...this.config.defaultMiddlewares];
    let roles = [...this.config.defaultRoles];

    if (route.disabled) {
      middlewares = middlewares.filter(m => !route.disabled!.includes(m));
    }

    if (route.enabled) {
      middlewares.push(...route.enabled);
    }

    if (route.excludeRoles) {
      roles = roles.filter(r => !route.excludeRoles!.includes(r));
    }

    if (route.roles) {
      roles = route.roles;
    }

    for (const middlewareName of middlewares) {
      const middleware = this.middlewareRegistry.get(middlewareName);
      if (!middleware) {
        throw new Error(\`Middleware '\${middlewareName}' not registered\`);
      }
      chain.push(middleware);
    }

    if (roles.length > 0) {
      const roleMiddleware = this.middlewareRegistry.get('roleCheck');
      if (roleMiddleware) {
        chain.push((roleMiddleware as any)(roles));
      }
    }

    return chain;
  }

  applyToHono(app: any) {
    for (const route of this.config.routes) {
      const middlewares = this.buildMiddlewareChain(route);
      const handler = this.resolveHandler(route.handler);
      const method = route.method.toLowerCase();
      
      app[method](route.path, ...middlewares, handler);
    }
    
    return app;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const route of this.config.routes) {
      try {
        this.resolveHandler(route.handler);
      } catch (error: any) {
        errors.push(\`Route \${route.method} \${route.path}: \${error.message}\`);
      }

      const allMiddlewares = [
        ...this.config.defaultMiddlewares,
        ...(route.enabled || [])
      ];

      for (const mw of allMiddlewares) {
        if (!this.middlewareRegistry.has(mw)) {
          errors.push(\`Route \${route.method} \${route.path}: Middleware '\${mw}' not registered\`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}

// Legacy RouteBuilder for backward compatibility
export interface RouteMiddlewareConfig {
  include?: string[];
  exclude?: string[];
  roles?: string[];
  excludeRole?: string[];
}

export class RouteBuilder {
  private defaultMiddlewares: string[] = [];
  private defaultRoles: string[] = [];
  private middlewareRegistry: Map<string, Function> = new Map();

  constructor(defaultMiddlewares: string[] = [], defaultRoles: string[] = []) {
    this.defaultMiddlewares = defaultMiddlewares;
    this.defaultRoles = defaultRoles;
  }

  registerMiddleware(name: string, middleware: Function) {
    this.middlewareRegistry.set(name, middleware);
  }

  buildMiddlewareChain(config?: RouteMiddlewareConfig): Function[] {
    const chain: Function[] = [];
    let middlewares = [...this.defaultMiddlewares];
    let roles = [...this.defaultRoles];

    if (config) {
      if (config.exclude) {
        middlewares = middlewares.filter(m => !config.exclude!.includes(m));
      }
      if (config.include) {
        middlewares.push(...config.include);
      }
      if (config.excludeRole) {
        roles = roles.filter(r => !config.excludeRole!.includes(r));
      }
      if (config.roles) {
        roles = config.roles;
      }
    }

    for (const middlewareName of middlewares) {
      const middleware = this.middlewareRegistry.get(middlewareName);
      if (!middleware) {
        throw new Error(\`Middleware '\${middlewareName}' not registered\`);
      }
      chain.push(middleware);
    }

    if (roles.length > 0) {
      const roleMiddleware = this.middlewareRegistry.get('roleCheck');
      if (roleMiddleware) {
        chain.push((roleMiddleware as any)(roles));
      }
    }

    return chain;
  }

  route(handler: Function, config?: RouteMiddlewareConfig): Function[] {
    const middlewares = this.buildMiddlewareChain(config);
    return [...middlewares, handler];
  }
}
`;

  await fs.outputFile(path.join(projectPath, `src/helpers/route-builder.${ext}`), declarativeRoutesContent);

  // Generate router config file
  const routerConfigContent = `import { DeclarativeRouter, METHODS } from '../helpers/route-builder.js';
import { apiAuditLog } from '../middlewares/audit.js';
${ctx.hasAuth ? "import { authMiddleware, roleMiddleware } from '../middlewares/auth.js';" : ''}

// Export METHODS for use in route files
export { METHODS };

export const globalDefaults = {
  middlewares: [${ctx.hasAuth ? "'auth', " : ''}'apiAuditLog'] as string[],
  roles: [] as string[]
};

export function createConfiguredRouter(config: {
  defaultMiddlewares?: string[];
  defaultRoles?: string[];
  routes: any[];
}) {
  const dr = new DeclarativeRouter({
    defaultMiddlewares: config.defaultMiddlewares || globalDefaults.middlewares,
    defaultRoles: config.defaultRoles || globalDefaults.roles,
    routes: config.routes
  });

  dr.registerMiddleware('apiAuditLog', apiAuditLog);
  ${ctx.hasAuth ? `dr.registerMiddleware('auth', authMiddleware);
  dr.registerMiddleware('roleCheck', roleMiddleware);` : ''}

  const validation = dr.validate();
  if (!validation.valid) {
    throw new Error(\`Route errors: \${validation.errors.join(', ')}\`);
  }

  return dr;
}
`;

  await fs.outputFile(path.join(projectPath, `src/config/router.${ext}`), routerConfigContent);

  // Generate example route with centralized config
  const routeContent = `import { Hono } from 'hono';
import { createConfiguredRouter } from '../config/router.js';
import { exampleController } from '../controllers/example.js';

export const routes = new Hono();

const routesList = [
  {
    method: METHODS.GET,
    path: '/example',
    handler: exampleController.getExample
  }${ctx.hasAuth ? `,
  
  {
    method: METHODS.GET,
    path: '/public',
    handler: exampleController.getPublic,
    disabled: ['auth']
  },
  
  {
    method: METHODS.POST,
    path: '/admin',
    handler: exampleController.adminAction,
    roles: ['admin', 'superAdmin']
  }` : ''}
];

const dr = createConfiguredRouter({ routes: routesList });
dr.applyToHono(routes);
`;

  await fs.outputFile(path.join(projectPath, `src/routes/index.${ext}`), routeContent);

  const controllerContent = `import { Context } from 'hono';
import { exampleService } from '../services/example.js';

export const exampleController = {
  async getExample(c: Context) {
    try {
      const data = await exampleService.getData();
      return c.json(data);
    } catch (error) {
      return c.json({ error: 'Failed to get data' }, 500);
    }
  },

  async getPublic(c: Context) {
    return c.json({ message: 'Public endpoint' });
  },

  async adminAction(c: Context) {
    return c.json({ message: 'Admin action performed' });
  }
};
`;

  await fs.outputFile(path.join(projectPath, `src/controllers/example.${ext}`), controllerContent);

  const serviceContent = `export const exampleService = {
  async getData() {
    return { message: 'Hello from shiv-am!' };
  }
};
`;

  await fs.outputFile(path.join(projectPath, `src/services/example.${ext}`), serviceContent);
}
