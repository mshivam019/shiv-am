// Main entry point for programmatic usage
export { initProject } from './commands/init.js';
export { addComponent } from './commands/add.js';
export { validateCommand } from './commands/validate.js';

export type {
  Framework,
  Database,
  Auth,
  Queue,
  Preset,
  ProjectConfig,
  RouteConfig,
  MiddlewareConfig,
  TemplateContext
} from './types/index.js';

// Version
export const version = '0.1.0';
