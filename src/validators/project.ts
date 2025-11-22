import * as fs from 'fs/promises';
import * as path from 'path';
import chalk from 'chalk';

export interface ValidationError {
  type: 'orphaned-route' | 'orphaned-middleware' | 'missing-service' | 'missing-controller';
  message: string;
  file?: string;
}

export async function validateProject(projectPath: string): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const routesPath = path.join(projectPath, 'src/routes');
    const controllersPath = path.join(projectPath, 'src/controllers');
    const servicesPath = path.join(projectPath, 'src/services');
    const middlewarePath = path.join(projectPath, 'src/middleware');

    const routeFiles = await getFiles(routesPath);
    const controllerFiles = await getFiles(controllersPath);
    const serviceFiles = await getFiles(servicesPath);
    const middlewareFiles = await getFiles(middlewarePath);

    // Extract names without extensions
    const controllers = new Set(controllerFiles.map(f => path.basename(f, '.ts')));
    const services = new Set(serviceFiles.map(f => path.basename(f, '.ts')));
    const middlewares = new Set(middlewareFiles.map(f => path.basename(f, '.ts')));

    // Check routes for missing controllers
    for (const routeFile of routeFiles) {
      const content = await fs.readFile(routeFile, 'utf-8');
      const controllerImports = extractImports(content, 'controllers');
      
      for (const controller of controllerImports) {
        if (!controllers.has(controller)) {
          errors.push({
            type: 'missing-controller',
            message: `Route references controller '${controller}' but it doesn't exist`,
            file: routeFile
          });
        }
      }
    }

    // Check controllers for missing services
    for (const controllerFile of controllerFiles) {
      const content = await fs.readFile(controllerFile, 'utf-8');
      const serviceImports = extractImports(content, 'services');
      
      for (const service of serviceImports) {
        if (!services.has(service)) {
          errors.push({
            type: 'missing-service',
            message: `Controller references service '${service}' but it doesn't exist`,
            file: controllerFile
          });
        }
      }
    }

    // Check for unused middleware
    const usedMiddlewares = new Set<string>();
    for (const routeFile of routeFiles) {
      const content = await fs.readFile(routeFile, 'utf-8');
      const middlewareImports = extractImports(content, 'middleware');
      middlewareImports.forEach(m => usedMiddlewares.add(m));
    }

    for (const middleware of middlewares) {
      if (middleware !== 'auth' && middleware !== 'logging' && !usedMiddlewares.has(middleware)) {
        errors.push({
          type: 'orphaned-middleware',
          message: `Middleware '${middleware}' is defined but never used`,
          file: path.join(middlewarePath, `${middleware}.ts`)
        });
      }
    }

  } catch (error) {
    console.error('Validation error:', error);
  }

  return errors;
}

async function getFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(
      entries.map(entry => {
        const fullPath = path.join(dir, entry.name);
        return entry.isDirectory() ? getFiles(fullPath) : [fullPath];
      })
    );
    return files.flat().filter(f => f.endsWith('.ts'));
  } catch {
    return [];
  }
}

function extractImports(content: string, folder: string): string[] {
  const regex = new RegExp(`from ['"]\\.\\./${folder}/([^'"]+)['"]`, 'g');
  const imports: string[] = [];
  let match;
  
  while ((match = regex.exec(content)) !== null) {
    imports.push(match[1]);
  }
  
  return imports;
}

export function printValidationErrors(errors: ValidationError[]) {
  if (errors.length === 0) {
    console.log(chalk.green('\n✅ No validation errors found\n'));
    return;
  }

  console.log(chalk.red(`\n❌ Found ${errors.length} validation error(s):\n`));
  
  errors.forEach((error, index) => {
    console.log(chalk.yellow(`${index + 1}. [${error.type}]`), error.message);
    if (error.file) {
      console.log(chalk.gray(`   File: ${error.file}`));
    }
  });
  
  console.log();
}
