// Declarative Route System

export const METHODS = {
  GET: 'GET',
  POST: 'POST',
  PUT: 'PUT',
  DELETE: 'DELETE',
  PATCH: 'PATCH'
} as const;

export type HttpMethod = typeof METHODS[keyof typeof METHODS];

export interface RouteDefinition {
  method: HttpMethod;
  path: string;
  handler: Function; // Direct function reference
  enabled?: string[]; // Additional middleware to enable
  disabled?: string[]; // Default middleware to disable
  roles?: string[]; // Required roles
  excludeRoles?: string[]; // Roles to exclude from defaults
}

export interface RouteConfig {
  defaultMiddlewares: string[];
  defaultRoles: string[];
  routes: RouteDefinition[];
}

export class DeclarativeRouter {
  private middlewareRegistry: Map<string, Function> = new Map();
  private config: RouteConfig;

  constructor(config: RouteConfig) {
    this.config = config;
  }

  registerMiddleware(name: string, middleware: Function) {
    this.middlewareRegistry.set(name, middleware);
    return this;
  }

  private buildMiddlewareChain(route: RouteDefinition): Function[] {
    const chain: Function[] = [];
    
    // Start with defaults
    let middlewares = [...this.config.defaultMiddlewares];
    let roles = [...this.config.defaultRoles];

    // Apply disabled (remove from defaults)
    if (route.disabled) {
      middlewares = middlewares.filter(m => !route.disabled!.includes(m));
    }

    // Apply enabled (add to chain)
    if (route.enabled) {
      middlewares.push(...route.enabled);
    }

    // Handle roles
    if (route.excludeRoles) {
      roles = roles.filter(r => !route.excludeRoles!.includes(r));
    }

    if (route.roles) {
      roles = route.roles;
    }

    // Build middleware chain
    for (const middlewareName of middlewares) {
      const middleware = this.middlewareRegistry.get(middlewareName);
      if (!middleware) {
        throw new Error(`Middleware '${middlewareName}' not registered`);
      }
      chain.push(middleware);
    }

    // Add role middleware if needed
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
      const method = route.method.toLowerCase();
      
      router[method](route.path, ...middlewares, route.handler);
    }
    
    return router;
  }

  applyToHono(app: any) {
    for (const route of this.config.routes) {
      const middlewares = this.buildMiddlewareChain(route);
      const method = route.method.toLowerCase();
      
      app[method](route.path, ...middlewares, route.handler);
    }
    
    return app;
  }

  validate(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    for (const route of this.config.routes) {
      // Check handler is a function
      if (typeof route.handler !== 'function') {
        errors.push(`Route ${route.method} ${route.path}: Handler is not a function`);
      }

      // Check middlewares exist
      const allMiddlewares = [
        ...this.config.defaultMiddlewares,
        ...(route.enabled || [])
      ];

      for (const mw of allMiddlewares) {
        if (!this.middlewareRegistry.has(mw)) {
          errors.push(`Route ${route.method} ${route.path}: Middleware '${mw}' not registered`);
        }
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }
}
