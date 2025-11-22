import * as fs from 'fs-extra';
import * as path from 'path';
import { ProjectConfig, TemplateContext } from '../../types/index.js';

export async function generateExpressProject(
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
  const appContent = `import express, { Express, Request, Response, NextFunction } from 'express';
import { router } from './routes/index.js';
${ctx.hasAuth ? "import { authMiddleware } from './middleware/auth.js';" : ''}
${ctx.hasCron ? "import { initCronJobs } from './cron/index.js';" : ''}

export function createApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Health check
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Routes
  app.use('/api', router);

  // Error handler
  app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
    console.error(err.stack);
    res.status(500).json({ error: 'Internal server error' });
  });

  ${ctx.hasCron ? 'initCronJobs();' : ''}

  return app;
}
`;

  await fs.outputFile(path.join(projectPath, `src/app.${ext}`), appContent);
}

async function generateServerFile(projectPath: string, config: ProjectConfig, ctx: TemplateContext) {
  const ext = ctx.fileExt;
  const serverContent = `import { createApp } from './app.js';
import { config } from './config/index.js';
${ctx.hasDatabase ? "import { connectDatabase } from './config/database.js';" : ''}

async function startServer() {
  ${ctx.hasDatabase ? 'await connectDatabase();' : ''}
  
  const app = createApp();
  
  app.listen(config.port, () => {
    console.log(\`🚀 Server running on port \${config.port}\`);
  });
}

startServer().catch(console.error);
`;

  await fs.outputFile(path.join(projectPath, `src/server.${ext}`), serverContent);
}

async function generateMiddleware(projectPath: string, config: ProjectConfig, ctx: TemplateContext) {
  const ext = ctx.fileExt;
  
  if (ctx.hasAuth) {
    const authMiddleware = `import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/index.js';

export interface AuthRequest extends Request {
  user?: any;
}

export function authMiddleware(req: AuthRequest, res: Response, next: NextFunction) {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

export function roleMiddleware(roles: string[]) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  };
}
`;

    await fs.outputFile(path.join(projectPath, `src/middlewares/auth.${ext}`), authMiddleware);
  }

  const loggingMiddleware = `import { Request, Response, NextFunction } from 'express';

export function loggingMiddleware(req: Request, res: Response, next: NextFunction) {
  console.log(\`[\${new Date().toISOString()}] \${req.method} \${req.path}\`);
  next();
}
`;

  await fs.outputFile(path.join(projectPath, `src/middlewares/logging.${ext}`), loggingMiddleware);

  // Generate API audit log middleware
  const auditLogMiddleware = `import { Request, Response, NextFunction } from 'express';

export interface AuthRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
    [key: string]: any;
  };
}

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

export function apiAuditLog(req: AuthRequest, res: Response, next: NextFunction) {
  const startTime = Date.now();
  
  // Capture request details
  const logEntry: AuditLogEntry = {
    timestamp: new Date().toISOString(),
    method: req.method,
    path: req.path,
    query: req.query,
    body: sanitizeBody(req.body),
    userId: req.user?.id,
    userEmail: req.user?.email,
    userRole: req.user?.role,
    ip: req.ip || req.socket.remoteAddress || 'unknown',
    userAgent: req.get('user-agent') || 'unknown'
  };

  // Capture response details
  res.on('finish', () => {
    logEntry.statusCode = res.statusCode;
    logEntry.responseTime = Date.now() - startTime;
    
    // Log to console (in production, send to logging service)
    logAuditEntry(logEntry);
  });

  next();
}

function sanitizeBody(body: any): any {
  if (!body) return body;
  
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
  
  // TODO: In production, send to logging service
  // await sendToLoggingService(entry);
}

// Optional: Export function to send logs to external service
export async function sendToLoggingService(entry: AuditLogEntry) {
  // Implement integration with your logging service
  // Examples: Datadog, Splunk, ELK Stack, CloudWatch, etc.
  
  // Example for HTTP logging service:
  // await fetch('https://your-logging-service.com/logs', {
  //   method: 'POST',
  //   headers: { 'Content-Type': 'application/json' },
  //   body: JSON.stringify(entry)
  // });
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
import { config } from './index.js';

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
import { config } from './index.js';

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
  
  // Generate declarative routes helper
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

  applyToExpress(router: any) {
    for (const route of this.config.routes) {
      const middlewares = this.buildMiddlewareChain(route);
      const handler = this.resolveHandler(route.handler);
      const method = route.method.toLowerCase();
      
      router[method](route.path, ...middlewares, handler);
    }
    
    return router;
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
import { loggingMiddleware } from '../middlewares/logging.js';
import { apiAuditLog } from '../middlewares/audit.js';
${ctx.hasAuth ? "import { authMiddleware, roleMiddleware } from '../middlewares/auth.js';" : ''}

// Export METHODS for use in route files
export { METHODS };

export const globalDefaults = {
  middlewares: [${ctx.hasAuth ? "'auth', " : ''}'apiAuditLog'],
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

  dr.registerMiddleware('logging', loggingMiddleware);
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
  const routeContent = `import { Router } from 'express';
import { createConfiguredRouter, METHODS } from '../config/router.js';
import { exampleController } from '../controllers/example.js';

export const router = Router();

const routes = [
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

const dr = createConfiguredRouter({ routes });
dr.applyToExpress(router);
`;

  await fs.outputFile(path.join(projectPath, `src/routes/index.${ext}`), routeContent);

  const controllerContent = `import { Request, Response } from 'express';
import { exampleService } from '../services/example.js';

export const exampleController = {
  async getExample(req: Request, res: Response) {
    try {
      const data = await exampleService.getData();
      res.json(data);
    } catch (error) {
      res.status(500).json({ error: 'Failed to get data' });
    }
  },

  async getPublic(req: Request, res: Response) {
    res.json({ message: 'Public endpoint' });
  },

  async adminAction(req: Request, res: Response) {
    res.json({ message: 'Admin action performed' });
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
