import Handlebars from 'handlebars';
import { TemplateContext } from '../types/index.js';

export function compileTemplate(template: string, context: TemplateContext): string {
  const compiled = Handlebars.compile(template);
  return compiled(context);
}

export function getTemplateContext(config: any): TemplateContext {
  const fileExt = config.typescript ? 'ts' : 'js';
  
  return {
    projectName: config.name,
    framework: config.framework,
    useTS: config.typescript,
    hasAuth: config.auth !== 'none',
    hasJWKS: config.auth === 'jwks',
    hasDatabase: config.database !== 'none',
    databaseType: config.database,
    hasQueue: config.queue !== 'none',
    hasCron: config.features.cron,
    hasLogging: config.features.logging,
    fileExt
  };
}
